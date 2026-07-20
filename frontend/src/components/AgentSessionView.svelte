<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import ContactList from "./ContactList.svelte";
  import ConcurrencyBoard from "./ConcurrencyBoard.svelte";
  import TerminalCalls from "./TerminalCalls.svelte";

  let { store }: { store: VisualizerStore } = $props();
</script>

<section class="agent-grid">
  <div class="column">
    <ContactList {store} developerMode={false} compact queuedOnly />
  </div>
  <div class="column">
    <ConcurrencyBoard {store} developerMode={false} title="Dialing" compact />
  </div>
  <div class="column">
    <TerminalCalls {store} />
  </div>
</section>

<style>
  .agent-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    align-items: start;
  }

  .column {
    min-width: 0;
  }

  @media (max-width: 1100px) {
    .agent-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
