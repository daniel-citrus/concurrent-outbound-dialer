<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { formatStatus } from "../lib/types";

  let { store }: { store: VisualizerStore } = $props();

  const sorted = $derived(
    [...store.contacts].sort((a, b) => a.position - b.position),
  );
</script>

<section class="panel">
  <header>
    <h2>Contact batch</h2>
    <p>Durable queue order from PostgreSQL.</p>
  </header>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>External ID</th>
          <th>Phone</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as contact (contact.id)}
          <tr data-status={contact.status}>
            <td class="mono">{contact.position}</td>
            <td class="mono">{contact.externalContactId}</td>
            <td class="mono">{contact.phoneNumber}</td>
            <td>{formatStatus(contact.status)}</td>
          </tr>
        {/each}
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
  }

  header h2 {
    font-size: 1.05rem;
  }

  header p {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .table-wrap {
    overflow: auto;
    max-height: 22rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
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
    border-bottom: 1px solid rgba(201, 191, 168, 0.45);
  }

  tr[data-status="dialing"] td:last-child,
  tr[data-status="claimed"] td:last-child {
    color: var(--accent-deep);
    font-weight: 600;
  }

  tr[data-status="answered"] td:last-child {
    color: var(--win);
    font-weight: 600;
  }

  tr[data-status="failed"] td:last-child,
  tr[data-status="canceled"] td:last-child {
    color: var(--fail);
  }
</style>
