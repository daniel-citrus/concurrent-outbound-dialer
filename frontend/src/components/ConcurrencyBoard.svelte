<script lang="ts">
  import type { CallAttempt, CallAttemptStatus } from "../lib/types";
  import { callStatusTone } from "../lib/call-status-display";
  import { formatStatus, isActiveCall } from "../lib/types";
  import { formatTimeAgo } from "../lib/contact-display";
  import type { VisualizerStore } from "../lib/store.svelte";

  let { store, developerMode = false }: { store: VisualizerStore; developerMode?: boolean } = $props();

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
    return callStatusTone(call.status, { isWinner: call.isWinner });
  }

  function statusLabel(call: CallAttempt): string {
    if (call.isWinner) return "winner";
    return formatStatus(call.status);
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
    <p>Select calls with the checkboxes, then apply a status from the simulate panel.</p>
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

  <div class="panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="select-col"></th>
            {#if developerMode}
              <th>Slot</th>
            {/if}
            <th>Call status</th>
            <th>Name</th>
            <th>Company</th>
            <th>Title</th>
            <th>Last Outbound</th>
            <th>Last Inbound</th>
          </tr>
        </thead>
        <tbody>
          {#each slots.filled as call, index (call.id)}
            {@const canSelect = isActiveCall(call.status) && !call.isWinner}
            {@const detail = store.getContactDetailByContactId(call.contactId)}
            <tr
              class:selected={canSelect && isSelected(call.id)}
              data-tone={slotTone(call)}
            >
              <td class="select-col">
                {#if canSelect}
                  <label class="select">
                    <input
                      type="checkbox"
                      checked={isSelected(call.id)}
                      disabled={store.busy}
                      onchange={() => toggleSelected(call.id)}
                    />
                  </label>
                {/if}
              </td>
              {#if developerMode}
                <td class="mono">{index + 1}</td>
              {/if}
              <td
                class="status-cell"
                data-tone={callStatusTone(call.status, { isWinner: call.isWinner })}
              >
                {statusLabel(call)}
              </td>
              <td>
                <div class="primary-cell">{detail.name}</div>
              </td>
              <td>{detail.company}</td>
              <td>{detail.title}</td>
              <td title={detail.lastOutboundType ?? undefined}>
                {formatTimeAgo(detail.lastOutboundAt)}
              </td>
              <td title={detail.lastInboundType ?? undefined}>
                {formatTimeAgo(detail.lastInboundAt)}
              </td>
            </tr>
          {/each}

          {#each Array(slots.empties) as _, index (index)}
            <tr class="empty" data-tone="open">
              <td class="select-col"></td>
              {#if developerMode}
                <td class="mono">{slots.filled.length + index + 1}</td>
              {/if}
              <td class="status-cell" data-tone="open">open permit</td>
              <td colspan="5" class="hint">Waiting for next claim</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
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
    border-color: rgba(74, 222, 128, 0.45);
    color: var(--win);
  }

  .panel {
    display: grid;
    gap: 0.85rem;
    padding: 1.1rem 1.25rem;
    background: var(--panel);
    border: 1px solid var(--line);
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
    vertical-align: middle;
  }

  tbody tr {
    animation: rise 280ms ease-out;
    box-shadow: inset 4px 0 0 var(--slot);
  }

  tbody tr.selected {
    background: rgba(45, 212, 191, 0.1);
  }

  tbody tr[data-tone="dialing"] {
    box-shadow: inset 4px 0 0 var(--accent);
  }

  tbody tr[data-tone="dialing"] .status-cell {
    color: var(--accent-deep);
    font-weight: 600;
  }

  tbody tr[data-tone="ringing"] {
    box-shadow: inset 4px 0 0 var(--ring);
    animation: pulse 1.4s ease-in-out infinite;
  }

  tbody tr[data-tone="ringing"] .status-cell {
    color: var(--ring);
    font-weight: 600;
  }

  tbody tr[data-tone="answered"],
  tbody tr[data-tone="winner"] {
    box-shadow: inset 4px 0 0 var(--win);
  }

  tbody tr[data-tone="answered"] .status-cell,
  tbody tr[data-tone="winner"] .status-cell {
    color: var(--win);
    font-weight: 600;
  }

  tbody tr[data-tone="completed"] .status-cell,
  tbody tr[data-tone="no-answer"] .status-cell,
  tbody tr[data-tone="busy"] .status-cell,
  tbody tr[data-tone="failed"] .status-cell,
  tbody tr[data-tone="canceled"] .status-cell {
    font-weight: 600;
  }

  tbody tr.empty {
    opacity: 0.72;
    box-shadow: inset 4px 0 0 rgba(45, 58, 77, 0.45);
  }

  tbody tr.empty td {
    border-bottom-style: dashed;
  }

  .select-col {
    width: 2rem;
    padding-left: 0.35rem;
  }

  .select {
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .select input {
    width: 0.95rem;
    height: 0.95rem;
    accent-color: var(--accent);
  }

  .primary-cell {
    font-weight: 600;
  }

  .sim {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .sim button {
    border: 1px solid var(--line);
    background: var(--button-bg);
    color: var(--ink);
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.28rem 0.45rem;
  }

  .sim button:hover:not(:disabled) {
    background: var(--button-hover);
    border-color: var(--accent);
    color: var(--accent-deep);
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
      background-color: transparent;
    }
    50% {
      background-color: rgba(251, 191, 36, 0.08);
    }
  }
</style>
