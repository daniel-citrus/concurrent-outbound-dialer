<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";

  let {
    store,
    onCreated,
  }: {
    store: VisualizerStore;
    onCreated: () => void;
  } = $props();

  let clientId = $state(`client-${Math.random().toString(36).slice(2, 7)}`);
  let agentId = $state("agent-1");
  let concurrencyLimit = $state(4);
  let contactsText = $state(
    [
      "contact-1,+14155550101",
      "contact-2,+14155550102",
      "contact-3,+14155550103",
      "contact-4,+14155550104",
      "contact-5,+14155550105",
      "contact-6,+14155550106",
    ].join("\n"),
  );

  async function submit(event: Event) {
    event.preventDefault();
    const contacts = contactsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [externalContactId, phoneNumber] = line.split(",").map((s) => s.trim());
        return { externalContactId: externalContactId ?? "", phoneNumber: phoneNumber ?? "" };
      })
      .filter((c) => c.externalContactId && c.phoneNumber);

    if (contacts.length === 0) {
      store.setError("Add at least one contact as externalId,+E164");
      return;
    }

    await store.createAndLoad({
      clientId: clientId.trim(),
      agentId: agentId.trim(),
      concurrencyLimit,
      contacts,
    });

    if (store.session) onCreated();
  }
</script>

<form class="setup" onsubmit={submit}>
  <header class="setup-head">
    <h2>New session</h2>
    <p>One ordered contact batch. Mock provider — no real Twilio calls.</p>
  </header>

  <div class="grid">
    <label>
      <span>Client ID</span>
      <input class="mono" bind:value={clientId} required />
    </label>
    <label>
      <span>Agent ID</span>
      <input class="mono" bind:value={agentId} required />
    </label>
    <label>
      <span>Concurrency (1–10)</span>
      <input type="number" min="1" max="10" bind:value={concurrencyLimit} required />
    </label>
  </div>

  <label class="contacts">
    <span>Contacts <em>externalId,+E164 — one per line, order preserved</em></span>
    <textarea class="mono" rows="8" bind:value={contactsText} spellcheck="false"></textarea>
  </label>

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
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.85rem;
  }

  label {
    display: grid;
    gap: 0.35rem;
  }

  label span {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-muted);
  }

  label em {
    font-style: normal;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 0.4rem;
    color: var(--ink-muted);
  }

  input,
  textarea {
    width: 100%;
    border: 1px solid var(--line);
    background: #fff;
    padding: 0.55rem 0.7rem;
    color: var(--ink);
  }

  textarea {
    resize: vertical;
    line-height: 1.45;
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
