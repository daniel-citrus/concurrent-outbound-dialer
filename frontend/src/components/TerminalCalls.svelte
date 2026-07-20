<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { callStatusTone } from "../lib/call-status-display";
  import { formatStatus, isActiveCall } from "../lib/types";

  let { store }: { store: VisualizerStore } = $props();

  const terminalCalls = $derived(
    [...store.calls]
      .filter((call) => !isActiveCall(call.status))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
  );
</script>

<section class="panel">
  <header>
    <h2>Terminal calls</h2>
  </header>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Company</th>
          <th>Outcome</th>
        </tr>
      </thead>
      <tbody>
        {#if terminalCalls.length === 0}
          <tr>
            <td colspan="3" class="empty">No terminal calls yet.</td>
          </tr>
        {:else}
          {#each terminalCalls as call (call.id)}
            {@const detail = store.getContactDetailByContactId(call.contactId)}
            <tr data-tone={callStatusTone(call.status, { isWinner: call.isWinner })}>
              <td>
                <div class="primary-cell">{detail.name}</div>
              </td>
              <td>{detail.company}</td>
              <td
                class="status-cell"
                data-tone={callStatusTone(call.status, { isWinner: call.isWinner })}
              >
                {call.isWinner && call.status === "completed"
                  ? "winner"
                  : formatStatus(call.status)}
              </td>
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
    min-height: 0;
  }

  header h2 {
    font-size: 1.05rem;
  }

  .table-wrap {
    overflow: auto;
    max-height: min(28rem, 60vh);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
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

  .status-cell {
    font-weight: 600;
    text-transform: capitalize;
  }
</style>
