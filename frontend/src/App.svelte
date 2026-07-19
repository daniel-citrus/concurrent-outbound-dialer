<script lang="ts">
  import { onMount } from "svelte";
  import { createVisualizerStore } from "./lib/store.svelte";
  import SessionSetup from "./components/SessionSetup.svelte";
  import SessionBar from "./components/SessionBar.svelte";
  import ConcurrencyBoard from "./components/ConcurrencyBoard.svelte";
  import ContactList from "./components/ContactList.svelte";
  import WinnerCard from "./components/WinnerCard.svelte";

  const store = createVisualizerStore();
  let phase = $state<"setup" | "session">("setup");

  onMount(() => {
    void store.refreshHealth();
    return () => store.stopPolling();
  });

  function backToSetup() {
    store.reset();
    phase = "setup";
  }
</script>

<div class="shell">
  <header class="top">
    <div>
      <p class="eyebrow">Concurrent outbound dialer</p>
      <h1>Visualizer</h1>
    </div>
    <div class="health" data-ok={store.healthOk}>
      <span class="dot"></span>
      {#if store.healthOk === null}
        Checking API…
      {:else if store.healthOk}
        Backend connected · mock provider
      {:else}
        Backend unreachable — run <code class="mono">npm run dev</code> on :3000
      {/if}
    </div>
  </header>

  {#if store.error}
    <div class="error" role="alert">{store.error}</div>
  {/if}

  {#if phase === "setup"}
    <SessionSetup store={store} onCreated={() => (phase = "session")} />
  {:else}
    <div class="session">
      <div class="toolbar">
        <button type="button" class="linkish" onclick={backToSetup}>← New session</button>
      </div>
      <SessionBar {store} />
      <WinnerCard {store} />
      <ConcurrencyBoard {store} />
      <ContactList {store} />
    </div>
  {/if}
</div>

<style>
  .shell {
    max-width: 1120px;
    margin: 0 auto;
    padding: 1.75rem 1.25rem 3rem;
    display: grid;
    gap: 1.15rem;
  }

  .top {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: end;
    flex-wrap: wrap;
  }

  .eyebrow {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-deep);
  }

  h1 {
    margin-top: 0.15rem;
    font-size: clamp(1.8rem, 4vw, 2.35rem);
    letter-spacing: -0.03em;
    font-weight: 700;
  }

  .health {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .health[data-ok="true"] {
    color: var(--accent-deep);
  }

  .health[data-ok="false"] {
    color: var(--fail);
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--ink-muted);
  }

  .health[data-ok="true"] .dot {
    background: var(--accent);
  }

  .health[data-ok="false"] .dot {
    background: var(--fail);
  }

  .error {
    padding: 0.75rem 1rem;
    background: rgba(185, 28, 28, 0.08);
    border: 1px solid rgba(185, 28, 28, 0.35);
    color: var(--fail);
    font-size: 0.9rem;
  }

  .session {
    display: grid;
    gap: 1rem;
  }

  .toolbar {
    display: flex;
  }

  .linkish {
    border: 0;
    background: transparent;
    color: var(--ink-muted);
    font-weight: 600;
    padding: 0;
  }

  .linkish:hover {
    color: var(--accent-deep);
  }

  code {
    font-size: 0.8em;
  }
</style>
