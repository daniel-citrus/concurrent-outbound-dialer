<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { formatStatus } from "../lib/types";

  let { store }: { store: VisualizerStore } = $props();

  const session = $derived(store.session);
  const snapshot = $derived(store.snapshot);

  const canStart = $derived(
    session?.status === "created" || session?.status === "paused",
  );
  const canPause = $derived(session?.status === "running");
  const canResume = $derived(session?.status === "paused");
  const canStop = $derived(
    !!session &&
      !["stopped", "completed", "failed"].includes(session.status),
  );
</script>

{#if session}
  <section class="bar">
    <div class="identity">
      <p class="label">Session</p>
      <p class="mono id">{session.id.slice(0, 8)}…</p>
      <p class="meta mono">
        {session.clientId} · {session.agentId}
      </p>
    </div>

    <div class="stat">
      <p class="label">Status</p>
      <p class="value status" data-status={session.status}>
        {formatStatus(session.status)}
      </p>
    </div>

    <div class="stat">
      <p class="label">Version</p>
      <p class="value mono">{snapshot?.stateVersion ?? session.stateVersion}</p>
    </div>

    <div class="stat">
      <p class="label">Active / limit</p>
      <p class="value mono">
        {snapshot?.activeCallCount ?? 0}/{session.concurrencyLimit}
      </p>
    </div>

    <div class="stat">
      <p class="label">Queued</p>
      <p class="value mono">{snapshot?.queuedContactCount ?? "—"}</p>
    </div>

    <div class="actions">
      {#if canStart && session.status === "created"}
        <button type="button" class="primary" disabled={store.busy} onclick={() => store.start()}>
          Start
        </button>
      {/if}
      {#if canPause}
        <button type="button" disabled={store.busy} onclick={() => store.pause()}>Pause</button>
      {/if}
      {#if canResume}
        <button type="button" class="primary" disabled={store.busy} onclick={() => store.resume()}>
          Resume
        </button>
      {/if}
      {#if canStop}
        <button type="button" class="danger" disabled={store.busy} onclick={() => store.stop()}>
          Stop
        </button>
      {/if}
      <button type="button" class="ghost" disabled={store.busy} onclick={() => store.refreshAll()}>
        Refresh
      </button>
    </div>
  </section>
{/if}

<style>
  .bar {
    display: grid;
    grid-template-columns: 1.4fr repeat(4, minmax(0, 1fr)) auto;
    gap: 1rem;
    align-items: end;
    padding: 1rem 1.25rem;
    background: var(--panel);
    border: 1px solid var(--line);
  }

  .label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--ink-muted);
  }

  .id {
    font-size: 1.05rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }

  .meta {
    margin-top: 0.15rem;
    font-size: 0.78rem;
    color: var(--ink-muted);
  }

  .value {
    margin-top: 0.2rem;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .status {
    text-transform: capitalize;
  }

  .status[data-status="running"] {
    color: var(--accent-deep);
  }

  .status[data-status="winner_selected"] {
    color: var(--win);
  }

  .status[data-status="paused"],
  .status[data-status="stopping"] {
    color: var(--warn);
  }

  .status[data-status="failed"] {
    color: var(--fail);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    justify-content: flex-end;
  }

  button {
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink);
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.45rem 0.75rem;
  }

  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  button.danger {
    background: transparent;
    border-color: var(--fail);
    color: var(--fail);
  }

  button.ghost {
    background: transparent;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 960px) {
    .bar {
      grid-template-columns: 1fr 1fr;
    }

    .actions {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
  }
</style>
