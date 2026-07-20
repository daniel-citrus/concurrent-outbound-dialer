<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import { resolveContactCallStatus } from "../lib/call-status-display";

  let { store, developerMode = false }: { store: VisualizerStore; developerMode?: boolean } = $props();

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
          {#if developerMode}
            <th>#</th>
          {/if}
          <th>Name</th>
          <th>Company</th>
          <th>Title</th>
          <th>Call status</th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as contact (contact.id)}
          {@const detail = store.getContactDetail(contact.externalContactId)}
          {@const callStatus = resolveContactCallStatus(contact.id, store.calls)}
          <tr>
            {#if developerMode}
              <td class="mono">{contact.position}</td>
            {/if}
            <td>
              <div class="primary-cell">{detail.name}</div>
            </td>
            <td>{detail.company}</td>
            <td>{detail.title}</td>
            <td class="call-status" data-tone={callStatus.tone}>{callStatus.label}</td>
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
    vertical-align: top;
  }

  .primary-cell {
    font-weight: 600;
  }
</style>
