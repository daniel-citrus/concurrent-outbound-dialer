<script lang="ts">
  import { onMount } from "svelte";
  import { dialerApi } from "../lib/api";
  import { formatActivity, formatTimeAgo } from "../lib/contact-display";
  import type { VisualizerStore } from "../lib/store.svelte";
  import { formatStatus, nebulaUserDisplayName } from "../lib/types";
  import type {
    NebulaProspectContact,
    NebulaProspectList,
    NebulaUser,
  } from "../lib/types";

  let {
    store,
    developerMode = false,
    onCreated,
  }: {
    store: VisualizerStore;
    developerMode?: boolean;
    onCreated: () => void;
  } = $props();

  const clientId = `client-${Math.random().toString(36).slice(2, 7)}`;
  let agentId = $state("");
  let prospectListId = $state("");
  let nebulaUsers = $state<NebulaUser[]>([]);
  let prospectLists = $state<NebulaProspectList[]>([]);
  let nebulaConfigured = $state(false);
  let nebulaUsersLoading = $state(true);
  let prospectListsLoading = $state(false);
  let prospectContactsLoading = $state(false);
  let contactBatchNote = $state("");
  let concurrencyLimit = $state(4);
  let autoContinue = $state(false);
  let selectedContacts = $state<NebulaProspectContact[]>([]);

  onMount(() => {
    void loadNebulaUsers();
  });

  $effect(() => {
    const selectedAgentId = agentId;
    if (!selectedAgentId) {
      prospectLists = [];
      prospectListId = "";
      selectedContacts = [];
      return;
    }

    void loadProspectLists(selectedAgentId);
  });

  async function loadNebulaUsers() {
    nebulaUsersLoading = true;
    try {
      const response = await dialerApi.getNebulaUsers();
      nebulaConfigured = response.configured;
      nebulaUsers = response.users;
      if (response.users.length > 0 && !agentId) {
        agentId = response.users[0]!.id;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load Nebula users";
      store.setError(message);
    } finally {
      nebulaUsersLoading = false;
    }
  }

  async function loadProspectLists(selectedAgentId: string) {
    prospectListsLoading = true;
    prospectListId = "";
    selectedContacts = [];
    contactBatchNote = "";
    try {
      const response = await dialerApi.getAgentProspectLists(selectedAgentId);
      prospectLists = response.lists;
    } catch (error) {
      prospectLists = [];
      const message =
        error instanceof Error ? error.message : "Failed to load prospect lists";
      store.setError(message);
    } finally {
      prospectListsLoading = false;
    }
  }

  async function onProspectListChange(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const listId = select.value;
    prospectListId = listId;
    contactBatchNote = "";

    if (!listId) {
      selectedContacts = [];
      return;
    }

    prospectContactsLoading = true;
    try {
      const response = await dialerApi.getProspectListContacts(listId);
      selectedContacts = response.contacts;

      const loaded = response.contacts.length;
      if (loaded === 0) {
        contactBatchNote = "No dialable contacts with phone numbers in this list.";
      } else if (response.skippedWithoutPhone > 0) {
        contactBatchNote = `Loaded ${loaded} contacts (${response.skippedWithoutPhone} skipped without a phone number).`;
      } else {
        contactBatchNote = `Loaded ${loaded} contacts from the selected list.`;
      }
    } catch (error) {
      selectedContacts = [];
      const message =
        error instanceof Error ? error.message : "Failed to load prospect list contacts";
      store.setError(message);
    } finally {
      prospectContactsLoading = false;
    }
  }

  async function submit(event: Event) {
    event.preventDefault();
    const contacts = selectedContacts.map((contact) => ({
      externalContactId: contact.externalContactId,
      phoneNumber: contact.phoneNumber,
    }));

    if (contacts.length === 0) {
      store.setError("Select a prospect list or add at least one contact as externalId,+E164");
      return;
    }

    if (!agentId.trim()) {
      store.setError("Select a Nebula agent");
      return;
    }

    const selectedAgent = nebulaUsers.find((user) => user.id === agentId.trim());

    await store.createAndLoad({
      clientId,
      agentId: agentId.trim(),
      agentLabel: selectedAgent
        ? nebulaUserDisplayName(selectedAgent)
        : agentId.trim(),
      concurrencyLimit,
      autoContinue,
      contacts,
      contactDetails: selectedContacts,
    });

    if (store.session) onCreated();
  }
</script>

<form class="setup" onsubmit={submit}>
  <header class="setup-head">
    <h2>New session</h2>
    {#if developerMode}
      <p>One ordered contact batch. Mock provider — no real Twilio calls.</p>
    {/if}
  </header>

  <div class="grid">
    <label>
      <span>Agent</span>
      <select class="mono" bind:value={agentId} required disabled={nebulaUsersLoading || nebulaUsers.length === 0}>
        {#if nebulaUsersLoading}
          <option value="">Loading Nebula users…</option>
        {:else if !nebulaConfigured}
          <option value="">Nebula not configured</option>
        {:else if nebulaUsers.length === 0}
          <option value="">No agents with prospect lists</option>
        {:else}
          {#each nebulaUsers as user (user.id)}
            <option value={user.id}>{user.label}</option>
          {/each}
        {/if}
      </select>
    </label>
    <label>
      <span>Prospect list</span>
      <select
        class="mono"
        value={prospectListId}
        onchange={onProspectListChange}
        disabled={prospectListsLoading || prospectContactsLoading || !agentId || prospectLists.length === 0}
      >
        {#if !agentId}
          <option value="">Select an agent first</option>
        {:else if prospectListsLoading}
          <option value="">Loading prospect lists…</option>
        {:else if prospectLists.length === 0}
          <option value="">No prospect lists for this agent</option>
        {:else}
          <option value="">Select a prospect list</option>
          {#each prospectLists as list (list.id)}
            <option value={list.id}>{list.label}</option>
          {/each}
        {/if}
      </select>
    </label>
    <label>
      <span>Concurrency (1–10)</span>
      <input type="number" min="1" max="10" bind:value={concurrencyLimit} required />
    </label>
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={autoContinue} />
      <span>Auto-continue after winning call</span>
    </label>
  </div>

  <div class="contacts">
    <span>
      Contacts
      <em>
        {#if prospectContactsLoading}
          Loading from prospect list…
        {:else}
          Loaded from the selected prospect list
        {/if}
      </em>
    </span>
    {#if contactBatchNote}
      <p class="batch-note">{contactBatchNote}</p>
    {/if}
    <div class="contacts-box">
      <div class="contacts-table-wrap">
        <table class="contacts-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Company</th>
              <th>Title</th>
              <th>Activity</th>
              <th>Last Outbound</th>
              <th>Last Inbound</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#if prospectContactsLoading}
              <tr>
                <td colspan="7" class="empty-state">Loading contacts…</td>
              </tr>
            {:else if selectedContacts.length === 0}
              <tr>
                <td colspan="7" class="empty-state">Select a prospect list to preview contacts.</td>
              </tr>
            {:else}
              {#each selectedContacts as contact (contact.externalContactId)}
                <tr>
                  <td>
                    <div class="primary-cell">{contact.name}</div>
                  </td>
                  <td>{contact.company}</td>
                  <td>{contact.title}</td>
                  <td>{formatActivity(contact.activity)}</td>
                  <td title={contact.lastOutboundType ?? undefined}>
                    {formatTimeAgo(contact.lastOutboundAt)}
                  </td>
                  <td title={contact.lastInboundType ?? undefined}>
                    {formatTimeAgo(contact.lastInboundAt)}
                  </td>
                  <td>{formatStatus(contact.status)}</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <button type="submit" disabled={store.busy}>Create session</button>
</form>

<style>
  .setup {
    display: grid;
    gap: 1.25rem;
    padding: 1.5rem;
    background: var(--panel);
    border: 1px solid var(--line);
  }

  .setup-head h2 {
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .setup-head p {
    margin-top: 0.35rem;
    color: var(--ink-muted);
    font-size: 0.92rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
  }

  .batch-note {
    margin: 0;
    font-size: 0.82rem;
    color: var(--accent-deep);
  }

  label {
    display: grid;
    gap: 0.35rem;
  }

  .checkbox-label {
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 0.5rem;
  }

  label span {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-muted);
  }

  .contacts em {
    font-style: normal;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 0.4rem;
    color: var(--ink-muted);
  }

  input,
  select {
    width: 100%;
    border: 1px solid var(--line);
    background: var(--input-bg);
    padding: 0.55rem 0.7rem;
    color: var(--ink);
  }

  input:focus,
  select:focus {
    outline: 2px solid rgba(45, 212, 191, 0.35);
    outline-offset: 1px;
    border-color: var(--accent);
  }

  .contacts-box {
    border: 1px solid var(--line);
    background: var(--input-bg);
  }

  .contacts-table-wrap {
    overflow: auto;
    max-height: 26rem;
  }

  .contacts-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 880px;
    font-size: 0.88rem;
  }

  .contacts-table th {
    text-align: left;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-muted);
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    background: var(--panel);
  }

  .contacts-table td {
    padding: 0.6rem 0.7rem;
    border-bottom: 1px solid rgba(45, 58, 77, 0.65);
    vertical-align: top;
  }

  .primary-cell {
    font-weight: 600;
  }

  .empty-state {
    color: var(--ink-muted);
  }

  button {
    justify-self: start;
    border: 0;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    padding: 0.7rem 1.15rem;
  }

  button:hover:not(:disabled) {
    background: var(--accent-deep);
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
