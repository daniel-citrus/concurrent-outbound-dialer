<script lang="ts">
  import type { CallAttempt, CallAttemptStatus } from "../lib/types";
  import { formatStatus, isActiveCall, SIMULATE_STATUSES } from "../lib/types";
  import type { VisualizerStore } from "../lib/store.svelte";

  let { store }: { store: VisualizerStore } = $props();

  let selectedIds = $state<string[]>([]);

  const session = $derived(store.session);
  const activeCalls = $derived(
    store.calls.filter((c) => isActiveCall(c.status) || c.isWinner),
  );
  const simulatable = $derived(
    store.calls.filter((c) => isActiveCall(c.status) && !c.isWinner),
  );
  const simulatableIds = $derived(simulatable.map((c) => c.id));
  const limit = $derived(session?.concurrencyLimit ?? 0);

  // Drop selections that are no longer simulatable (terminal / cancelled / missing).
  $effect(() => {
    const allowed = new Set(simulatableIds);
    const next = selectedIds.filter((id) => allowed.has(id));
    if (next.length !== selectedIds.length) {
      selectedIds = next;
    }
  });

  const selectedCount = $derived(selectedIds.length);
  const allSelected = $derived(
    simulatableIds.length > 0 && selectedCount === simulatableIds.length,
  );

  const slots = $derived.by(() => {
    const filled = activeCalls.slice(0, limit);
    const empties = Math.max(0, limit - filled.length);
    return { filled, empties };
  });

  const quickActions: CallAttemptStatus[] = [
    "ringing",
    "in_progress",
    "no_answer",
    "busy",
    "failed",
  ];

  function slotTone(call: CallAttempt): string {
    if (call.isWinner) return "winner";
    if (call.status === "ringing") return "ringing";
    if (call.status === "in_progress") return "answered";
    if (call.status === "creating" || call.status === "queued" || call.status === "initiated") {
      return "dialing";
    }
    return "idle";
  }

  function isSelected(id: string): boolean {
    return selectedIds.includes(id);
  }

  function toggleSelected(id: string) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((x) => x !== id);
    } else {
      selectedIds = [...selectedIds, id];
    }
  }

  function selectAll() {
    selectedIds = [...simulatableIds];
  }

  function clearSelection() {
    selectedIds = [];
  }

  async function applySelected(status: CallAttemptStatus) {
    await store.simulateMany(selectedIds, status);
    clearSelection();
  }
</script>

<section class="board">
  <header>
    <h2>Concurrency board</h2>
    <p>
      Select calls with the checkboxes, then apply a status to the selection — or use All for every
      active slot.
    </p>
  </header>

  {#if simulatable.length > 0}
    <div class="bulk">
      <div class="bulk-label">
        <span>Simulate</span>
        <span class="mono count">{selectedCount} selected · {simulatable.length} active</span>
      </div>

      <div class="select-row">
        <button type="button" class="text-btn" disabled={store.busy || allSelected} onclick={selectAll}>
          Select all
        </button>
        <button
          type="button"
          class="text-btn"
          disabled={store.busy || selectedCount === 0}
          onclick={clearSelection}
        >
          Clear
        </button>
      </div>

      <div class="action-block">
        <p class="action-label">Selected →</p>
        <div class="sim">
          {#each quickActions as status}
            <button
              type="button"
              class:winner-action={status === "in_progress"}
              disabled={store.busy || selectedCount === 0}
              onclick={() => applySelected(status)}
            >
              {formatStatus(status)}
            </button>
          {/each}
        </div>
        <details>
          <summary>More selected statuses</summary>
          <div class="sim">
            {#each SIMULATE_STATUSES as status}
              <button
                type="button"
                disabled={store.busy || selectedCount === 0}
                onclick={() => applySelected(status)}
              >
                {formatStatus(status)}
              </button>
            {/each}
          </div>
        </details>
      </div>

      <div class="action-block">
        <p class="action-label">All active →</p>
        <div class="sim">
          {#each quickActions as status}
            <button
              type="button"
              class:winner-action={status === "in_progress"}
              disabled={store.busy}
              onclick={() => store.simulateAllActive(status)}
            >
              {formatStatus(status)}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <div class="slots" style={`--cols: ${Math.max(limit, 1)}`}>
    {#each slots.filled as call (call.id)}
      {@const canSelect = isActiveCall(call.status) && !call.isWinner}
      <article
        class="slot"
        class:selected={canSelect && isSelected(call.id)}
        data-tone={slotTone(call)}
      >
        <div class="slot-top">
          {#if canSelect}
            <label class="select">
              <input
                type="checkbox"
                checked={isSelected(call.id)}
                disabled={store.busy}
                onchange={() => toggleSelected(call.id)}
              />
              <span class="badge">{formatStatus(call.status)}</span>
            </label>
          {:else}
            <span class="badge">{call.isWinner ? "winner" : formatStatus(call.status)}</span>
          {/if}
          <span class="mono tiny">{call.id.slice(0, 8)}</span>
        </div>
        <p class="mono phone">
          {store.contacts.find((c) => c.id === call.contactId)?.phoneNumber ?? "—"}
        </p>
        <p class="mono provider">{call.providerCallId ?? "creating…"}</p>

        {#if canSelect}
          <div class="sim">
            {#each quickActions as status}
              <button
                type="button"
                disabled={store.busy || call.status === status}
                onclick={() => store.simulate(call.id, status)}
              >
                {formatStatus(status)}
              </button>
            {/each}
          </div>
          <details>
            <summary>More statuses</summary>
            <div class="sim">
              {#each SIMULATE_STATUSES as status}
                <button
                  type="button"
                  disabled={store.busy || call.status === status}
                  onclick={() => store.simulate(call.id, status)}
                >
                  {formatStatus(status)}
                </button>
              {/each}
            </div>
          </details>
        {:else if call.isWinner}
          <p class="hint">Winner selected — other legs cancel/disconnect.</p>
        {/if}
      </article>
    {/each}

    {#each Array(slots.empties) as _, i (i)}
      <article class="slot empty">
        <span class="badge">open permit</span>
        <p class="hint">Waiting for next claim</p>
      </article>
    {/each}
  </div>
</section>

<style>
  .board {
    display: grid;
    gap: 1rem;
  }

  header h2 {
    font-size: 1.1rem;
    letter-spacing: -0.02em;
  }

  header p {
    margin-top: 0.35rem;
    color: var(--ink-muted);
    font-size: 0.9rem;
    max-width: 52rem;
  }

  .bulk {
    display: grid;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
  }

  .bulk-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-muted);
  }

  .count {
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
  }

  .select-row {
    display: flex;
    gap: 0.75rem;
  }

  .text-btn {
    border: 0;
    background: transparent;
    padding: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent-deep);
  }

  .text-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .action-block {
    display: grid;
    gap: 0.4rem;
  }

  .action-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-muted);
  }

  .sim button.winner-action {
    border-color: rgba(21, 128, 61, 0.45);
    color: var(--win);
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.85rem;
  }

  .slot {
    display: grid;
    gap: 0.5rem;
    padding: 0.9rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-left: 4px solid var(--slot);
    min-height: 9.5rem;
    animation: rise 280ms ease-out;
  }

  .slot.selected {
    border-color: var(--accent);
    background: rgba(13, 148, 136, 0.06);
  }

  .slot[data-tone="dialing"] {
    border-left-color: var(--accent);
  }

  .slot[data-tone="ringing"] {
    border-left-color: var(--ring);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .slot[data-tone="answered"],
  .slot[data-tone="winner"] {
    border-left-color: var(--win);
  }

  .slot.empty {
    opacity: 0.72;
    background: transparent;
    border-style: dashed;
  }

  .slot-top {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
  }

  .select {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
  }

  .select input {
    width: 0.95rem;
    height: 0.95rem;
    accent-color: var(--accent);
  }

  .badge {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tiny {
    font-size: 0.72rem;
    color: var(--ink-muted);
  }

  .phone {
    font-size: 1rem;
    font-weight: 600;
  }

  .provider {
    font-size: 0.75rem;
    color: var(--ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sim {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .sim button,
  details button {
    border: 1px solid var(--line);
    background: #fff;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.28rem 0.45rem;
  }

  .sim button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent-deep);
  }

  details summary {
    font-size: 0.75rem;
    color: var(--ink-muted);
    cursor: pointer;
  }

  .hint {
    font-size: 0.8rem;
    color: var(--ink-muted);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(217, 119, 6, 0);
    }
    50% {
      box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.18);
    }
  }
</style>
