<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { resolveContactCallStatus } from "../lib/call-status-display";

  let {
    store,
    developerMode = false,
    compact = false,
    /** When true, only show contacts still waiting in the queue (conveyor belt). */
    queuedOnly = false,
  }: {
    store: VisualizerStore;
    developerMode?: boolean;
    compact?: boolean;
    queuedOnly?: boolean;
  } = $props();

  const sorted = $derived(
    [...store.contacts]
      .filter((contact) => !queuedOnly || contact.status === "queued")
      .sort((a, b) => a.position - b.position),
  );

  const showCallStatus = $derived(!queuedOnly);
</script>

<section class="panel" class:compact>
  <header>
    <h2>Contact batch</h2>
    {#if !compact}
      <p>Durable queue order from PostgreSQL.</p>
    {/if}
  </header>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          {#if developerMode}
            <th>#</th>
          {/if}
          <th>Name</th>
          <th>Company</th>
          <th>Title</th>
          {#if showCallStatus}
            <th>Call status</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#if sorted.length === 0}
          <tr>
            <td colspan={developerMode ? (showCallStatus ? 5 : 4) : showCallStatus ? 4 : 3} class="empty">
              {#if queuedOnly}
                No contacts waiting — all have moved to dialing or terminal.
              {:else}
                No contacts in this session.
              {/if}
            </td>
          </tr>
        {:else}
          {#each sorted as contact (contact.id)}
            {@const detail = store.getContactDetail(contact.externalContactId)}
            {@const callStatus = resolveContactCallStatus(contact.id, store.calls)}
            <tr>
              {#if developerMode}
                <td class="mono">{contact.position}</td>
              {/if}
              <td>
                <div class="primary-cell">{detail.name}</div>
              </td>
              <td>{detail.company}</td>
              <td>{detail.title}</td>
              {#if showCallStatus}
                <td class="call-status" data-tone={callStatus.tone}>{callStatus.label}</td>
              {/if}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</section>

<style>
  .panel {
    display: grid;
    gap: 0.85rem;
    padding: 1.1rem 1.25rem;
    background: var(--panel);
    border: 1px solid var(--line);
  }

  header h2 {
    font-size: 1.05rem;
  }

  header p {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .table-wrap {
    overflow: auto;
    max-height: 22rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    min-width: 880px;
  }

  th {
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-muted);
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    background: var(--panel);
  }

  td {
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid rgba(45, 58, 77, 0.65);
    vertical-align: top;
  }

  .primary-cell {
    font-weight: 600;
  }

  .empty {
    color: var(--ink-muted);
    font-size: 0.85rem;
  }

  .panel.compact {
    height: 100%;
  }

  .panel.compact .table-wrap {
    max-height: min(28rem, 60vh);
  }

  .panel.compact table {
    min-width: 0;
    font-size: 0.84rem;
  }
</style>
