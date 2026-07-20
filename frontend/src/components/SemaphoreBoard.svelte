<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { callStatusTone } from "../lib/call-status-display";
  import { formatStatus } from "../lib/types";

  let { store }: { store: VisualizerStore } = $props();

  const runtime = $derived(store.runtime);

  const permitSlots = $derived.by(() => {
    if (!runtime) {
      return [];
    }

    const slots: Array<"held" | "open"> = [];
    for (let i = 0; i < runtime.semaphore.occupiedPermits; i += 1) {
      slots.push("held");
    }
    for (let i = 0; i < runtime.semaphore.availablePermits; i += 1) {
      slots.push("open");
    }
    return slots;
  });

  const summaryLine = $derived.by(() => {
    if (!runtime) {
      return "Runtime unavailable";
    }

    const { semaphore } = runtime;
    return `${semaphore.occupiedPermits}/${semaphore.capacity} held · ${semaphore.availablePermits} open`;
  });
</script>

<details class="panel">
  <summary class="panel-summary">
    <span class="summary-title">
      <span class="summary-heading">Semaphore</span>
      <span class="summary-meta mono">{summaryLine}</span>
    </span>
    <span class="summary-chevron" aria-hidden="true"></span>
  </summary>

  <div class="panel-body">
    <p class="intro">In-memory admission control for this session controller.</p>

  {#if !runtime}
    <p class="empty">Runtime snapshot unavailable.</p>
  {:else}
    <div class="permits">
      <div class="permits-head">
        <span>Permits</span>
        <span class="hint">filled slots hold a permit</span>
      </div>
      <div class="permit-row">
        {#each permitSlots as slot, index (index)}
          <div class="permit" data-state={slot} title={slot === "held" ? "Permit held" : "Permit available"}></div>
        {/each}
      </div>
    </div>

    <div class="resources">
      <div class="resources-head">
        <span>Resources</span>
        <span class="hint">active calls holding permits</span>
      </div>

      {#if runtime.resources.length === 0}
        <p class="empty inline">No permits currently held.</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Call attempt</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Call status</th>
                <th>Permit</th>
              </tr>
            </thead>
            <tbody>
              {#each runtime.resources as resource (resource.callAttemptId)}
                <tr data-released={resource.permitReleased}>
                  <td class="mono">{resource.callAttemptId.slice(0, 8)}</td>
                  <td>
                    {resource.contactId
                      ? store.getContactDetailByContactId(resource.contactId).name
                      : "—"}
                  </td>
                  <td class="mono">{resource.phoneNumber ?? "—"}</td>
                  <td
                    class="call-status"
                    data-tone={resource.callStatus ? callStatusTone(resource.callStatus) : "neutral"}
                  >
                    {resource.callStatus ? formatStatus(resource.callStatus) : "—"}
                  </td>
                  <td>{resource.permitReleased ? "released" : "held"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
  </div>
</details>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
  }

  .panel-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.9rem 1.25rem;
    cursor: pointer;
    list-style: none;
  }

  .panel-summary::-webkit-details-marker {
    display: none;
  }

  .summary-title {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .summary-heading {
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .summary-meta {
    font-size: 0.78rem;
    color: var(--ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-chevron {
    width: 0.55rem;
    height: 0.55rem;
    border-right: 2px solid var(--ink-muted);
    border-bottom: 2px solid var(--ink-muted);
    transform: rotate(45deg);
    transition: transform 160ms ease;
    flex-shrink: 0;
  }

  .panel[open] .summary-chevron {
    transform: rotate(225deg);
  }

  .panel-body {
    display: grid;
    gap: 1rem;
    padding: 0 1.25rem 1.1rem;
    border-top: 1px solid var(--line);
  }

  .intro {
    margin: 0.9rem 0 0;
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .permits,
  .resources {
    display: grid;
    gap: 0.55rem;
  }

  .permits-head,
  .resources-head {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: baseline;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-muted);
  }

  .hint {
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-muted);
  }

  .permit-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .permit {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 0.35rem;
    border: 1px solid var(--line);
    animation: rise 280ms ease-out;
  }

  .permit[data-state="held"] {
    background: linear-gradient(180deg, rgba(45, 212, 191, 0.35), rgba(20, 184, 166, 0.18));
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px rgba(45, 212, 191, 0.25);
  }

  .permit[data-state="open"] {
    background: transparent;
    border-style: dashed;
    opacity: 0.75;
  }

  .table-wrap {
    overflow: auto;
    max-height: 14rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
  }

  th {
    text-align: left;
    font-size: 0.68rem;
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
  }

  tr[data-released="true"] td {
    opacity: 0.55;
  }

  .empty {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.88rem;
  }

  .empty.inline {
    padding: 0.35rem 0;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
