<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { callStatusTone } from "../lib/call-status-display";
  import { formatStatus } from "../lib/types";

  let { store }: { store: VisualizerStore } = $props();

  const winner = $derived(
    store.snapshot?.winningCall ??
      store.calls.find((c) => c.isWinner) ??
      null,
  );

  const contact = $derived(
    winner ? store.contacts.find((c) => c.id === winner.contactId) : null,
  );
</script>

{#if winner}
  <section class="winner">
    <p class="label">Winning call</p>
    <h2 class="mono">{contact?.phoneNumber ?? "—"}</h2>
    <p class="meta mono">
      {contact?.externalContactId ?? winner.contactId} ·
      <span class="call-status" data-tone={callStatusTone(winner.status, { isWinner: true })}>
        {formatStatus(winner.status)}
      </span>
      · {winner.providerCallId ?? "no provider id"}
    </p>
  </section>
{/if}

<style>
  .winner {
    padding: 1.1rem 1.25rem;
    background: linear-gradient(120deg, rgba(74, 222, 128, 0.14), rgba(22, 29, 39, 0.95));
    border: 1px solid rgba(74, 222, 128, 0.35);
    animation: rise 320ms ease-out;
  }

  .label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--win);
  }

  h2 {
    margin-top: 0.35rem;
    font-size: 1.45rem;
    letter-spacing: -0.02em;
  }

  .meta {
    margin-top: 0.35rem;
    font-size: 0.82rem;
    color: var(--ink-muted);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
