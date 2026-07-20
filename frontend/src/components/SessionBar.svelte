<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { formatStatus } from "../lib/types";

  let { store, developerMode = false }: { store: VisualizerStore; developerMode?: boolean } = $props();

  const session = $derived(store.session);
  const snapshot = $derived(store.snapshot);

  const showStart = $derived(
    !!session &&
      (session.status === "created" ||
        (session.status === "winner_selected" &&
          (snapshot?.queuedContactCount ?? 0) > 0)),
  );

  const startDisabled = $derived(
    store.busy || (snapshot?.activeCallCount ?? 0) > 0,
  );

  const canPause = $derived(session?.status === "running");
  const canResume = $derived(session?.status === "paused");
  const canStop = $derived(
    !!session &&
      !["stopped", "completed", "failed"].includes(session.status),
  );

  const canToggleAutoContinue = $derived(
    !!session && !["stopped", "completed", "failed"].includes(session.status),
  );
</script>

{#if session}
  <section class="bar">
    <div class="identity">
      <p class="label">Agent</p>
      <p class="id">{store.agentLabel ?? session.agentId}</p>
      {#if developerMode}
        <p class="meta mono">{session.id}</p>
      {/if}
    </div>

    <div class="stat">
      <p class="label">Status</p>
      <p class="value status" data-status={session.status}>
        {formatStatus(session.status)}
      </p>
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
      {#if canToggleAutoContinue}
        <label class="toggle" title="When enabled, dialing resumes automatically after a winning call ends">
          <input
            type="checkbox"
            checked={session.autoContinue}
            disabled={store.busy}
            onchange={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              void store.setAutoContinue(input.checked);
            }}
          />
          <span>Auto-continue</span>
        </label>
      {/if}
      {#if showStart}
        <button
          type="button"
          class="primary"
          disabled={startDisabled}
          title={startDisabled ? "Finish the current call before starting" : undefined}
          onclick={() => store.start()}
        >
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
    </div>
  </section>
{/if}

<style>
  .bar {
    display: grid;
    grid-template-columns: 1.4fr repeat(3, minmax(0, 1fr)) auto;
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
    overflow-wrap: anywhere;
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
    align-items: center;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink-muted);
    cursor: pointer;
    user-select: none;
  }

  .toggle input {
    accent-color: var(--accent);
  }

  button {
    border: 1px solid var(--line);
    background: var(--button-bg);
    color: var(--ink);
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.45rem 0.75rem;
  }

  button:hover:not(:disabled):not(.primary):not(.danger) {
    background: var(--button-hover);
    border-color: var(--accent);
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
