<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
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
      {contact?.externalContactId ?? winner.contactId} · {formatStatus(winner.status)} ·
      {winner.providerCallId ?? "no provider id"}
    </p>
  </section>
{/if}

<style>
  .winner {
    padding: 1.1rem 1.25rem;
    background: linear-gradient(120deg, rgba(21, 128, 61, 0.12), rgba(251, 248, 241, 0.9));
    border: 1px solid rgba(21, 128, 61, 0.35);
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
