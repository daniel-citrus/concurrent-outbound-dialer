<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { callStatusTone } from "../lib/call-status-display";
  import { formatStatus, isActiveCall } from "../lib/types";

  let { store }: { store: VisualizerStore } = $props();

  const winner = $derived(
    store.snapshot?.winningCall ??
      store.calls.find((c) => c.isWinner) ??
      null,
  );

  const open = $derived(
    !!winner &&
      store.session?.status === "winner_selected" &&
      isActiveCall(winner.status),
  );

  const detail = $derived(
    winner ? store.getContactDetailByContactId(winner.contactId) : null,
  );

  const contact = $derived(
    winner ? store.contacts.find((c) => c.id === winner.contactId) : null,
  );

  const canHangUp = $derived(!!winner && isActiveCall(winner.status));

  async function hangUp() {
    if (!winner || !canHangUp) return;
    await store.simulate(winner.id, "completed");
  }
</script>

{#if open && winner}
  <div class="backdrop" role="presentation">
    <div
      class="popup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="winner-popup-title"
    >
      <p class="label">Connected</p>
      <h2 id="winner-popup-title">{detail?.name ?? "Unknown contact"}</h2>
      <p class="phone mono">{contact?.phoneNumber ?? "—"}</p>
      <p class="meta">
        {detail?.company ?? "—"}
        {#if detail?.title}
          · {detail.title}
        {/if}
      </p>
      <p class="status-line">
        <span class="call-status" data-tone={callStatusTone(winner.status, { isWinner: true })}>
          {formatStatus(winner.status)}
        </span>
      </p>

      <div class="actions">
        <button
          type="button"
          class="hangup"
          disabled={store.busy || !canHangUp}
          onclick={() => void hangUp()}
        >
          Hang up
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: rgba(8, 12, 18, 0.72);
    backdrop-filter: blur(4px);
    animation: fade-in 200ms ease-out;
  }

  .popup {
    width: min(100%, 26rem);
    padding: 1.35rem 1.4rem 1.25rem;
    background: var(--panel);
    border: 1px solid rgba(74, 222, 128, 0.4);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
    animation: rise 280ms ease-out;
  }

  .label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--win);
  }

  h2 {
    margin-top: 0.45rem;
    font-size: 1.35rem;
    letter-spacing: -0.02em;
    font-weight: 700;
  }

  .phone {
    margin-top: 0.35rem;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .meta {
    margin-top: 0.3rem;
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .status-line {
    margin-top: 0.75rem;
    font-size: 0.82rem;
  }

  .actions {
    margin-top: 1.15rem;
    display: flex;
    justify-content: flex-end;
  }

  .hangup {
    border: 1px solid var(--fail);
    background: rgba(248, 113, 113, 0.12);
    color: var(--fail);
    font-weight: 700;
    font-size: 0.9rem;
    padding: 0.55rem 1.1rem;
  }

  .hangup:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.22);
  }

  .hangup:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
