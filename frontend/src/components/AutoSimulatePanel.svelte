<script lang="ts">
  import type { VisualizerStore } from "../lib/store.svelte";
  import type { MockAutoSimulateConfig } from "../lib/types";

  let { store }: { store: VisualizerStore } = $props();

  let draft = $state<MockAutoSimulateConfig | null>(null);

  const config = $derived(store.autoSimulateConfig);
  const available = $derived(store.autoSimulateAvailable);

  $effect(() => {
    if (config) {
      draft = { ...config };
    }
  });

  const dirty = $derived.by(() => {
    if (!draft || !config) return false;
    return (Object.keys(draft) as Array<keyof MockAutoSimulateConfig>).some(
      (key) => draft![key] !== config[key],
    );
  });

  async function save() {
    if (!draft) return;
    await store.updateAutoSimulateConfig(draft);
  }

  async function resetDefaults() {
    await store.resetAutoSimulateConfig();
  }

  function updateNumber(key: keyof MockAutoSimulateConfig, raw: string) {
    if (!draft) return;
    const value = Number(raw);
    if (Number.isNaN(value)) return;
    draft = { ...draft, [key]: value };
  }
</script>

<details class="panel" open>
  <summary class="panel-summary">
    <span class="summary-title">
      <span class="summary-heading">Auto-simulate settings</span>
      <span class="summary-meta mono">
        {#if !available}
          unavailable
        {:else if store.autoSimulateEnabled}
          on · {Math.round((config?.answerRate ?? 0) * 100)}% answer
        {:else}
          paused
        {/if}
      </span>
    </span>
    <span class="summary-chevron" aria-hidden="true"></span>
  </summary>

  <div class="panel-body">
    {#if !available}
      <p class="empty">Set <code class="mono">MOCK_AUTO_SIMULATE=true</code> on the API to configure.</p>
    {:else if draft}
      <p class="intro">
        Applies to new status steps immediately. Turn off Auto-simulate above to drive calls manually.
      </p>

      <div class="grid">
        <label class="field">
          <span>Answer rate</span>
          <div class="row">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draft.answerRate}
              disabled={store.busy}
              oninput={(e) => updateNumber("answerRate", e.currentTarget.value)}
            />
            <span class="mono value">{Math.round(draft.answerRate * 100)}%</span>
          </div>
        </label>

        <label class="field">
          <span>Step delay min (ms)</span>
          <input
            type="number"
            min="0"
            step="50"
            value={draft.minStepMs}
            disabled={store.busy}
            oninput={(e) => updateNumber("minStepMs", e.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Step delay max (ms)</span>
          <input
            type="number"
            min="0"
            step="50"
            value={draft.maxStepMs}
            disabled={store.busy}
            oninput={(e) => updateNumber("maxStepMs", e.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Talk time min (ms)</span>
          <input
            type="number"
            min="0"
            step="100"
            value={draft.minTalkMs}
            disabled={store.busy}
            oninput={(e) => updateNumber("minTalkMs", e.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Talk time max (ms)</span>
          <input
            type="number"
            min="0"
            step="100"
            value={draft.maxTalkMs}
            disabled={store.busy}
            oninput={(e) => updateNumber("maxTalkMs", e.currentTarget.value)}
          />
        </label>
      </div>

      <p class="section-label">Non-answer outcome weights</p>
      <div class="grid weights">
        <label class="field">
          <span>Busy</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={draft.busyWeight}
            disabled={store.busy}
            oninput={(e) => updateNumber("busyWeight", e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>Failed</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={draft.failedWeight}
            disabled={store.busy}
            oninput={(e) => updateNumber("failedWeight", e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>No answer</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={draft.noAnswerWeight}
            disabled={store.busy}
            oninput={(e) => updateNumber("noAnswerWeight", e.currentTarget.value)}
          />
        </label>
      </div>

      <div class="actions">
        <button type="button" class="secondary" disabled={store.busy} onclick={() => void resetDefaults()}>
          Reset defaults
        </button>
        <button type="button" disabled={store.busy || !dirty} onclick={() => void save()}>
          Apply
        </button>
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
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    cursor: pointer;
    user-select: none;
  }

  .panel-summary::-webkit-details-marker {
    display: none;
  }

  .summary-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.55rem 0.85rem;
    min-width: 0;
  }

  .summary-heading {
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .summary-meta {
    font-size: 0.78rem;
    color: var(--ink-muted);
  }

  .summary-chevron {
    width: 0.45rem;
    height: 0.45rem;
    border-right: 2px solid var(--ink-muted);
    border-bottom: 2px solid var(--ink-muted);
    transform: rotate(45deg);
    transition: transform 140ms ease;
    flex-shrink: 0;
  }

  details[open] .summary-chevron {
    transform: rotate(225deg);
  }

  .panel-body {
    padding: 0 1rem 1rem;
    display: grid;
    gap: 0.85rem;
    border-top: 1px solid var(--line);
  }

  .intro,
  .empty {
    margin-top: 0.85rem;
    color: var(--ink-muted);
    font-size: 0.88rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem;
  }

  .weights {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .field {
    display: grid;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--ink-muted);
  }

  .field input[type="number"] {
    width: 100%;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--line);
    background: rgba(0, 0, 0, 0.2);
    color: var(--ink);
    font: inherit;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .row input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
  }

  .value {
    min-width: 2.75rem;
    text-align: right;
    color: var(--ink);
    font-size: 0.85rem;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  button {
    border: 1px solid var(--accent);
    background: rgba(74, 222, 128, 0.12);
    color: var(--accent-deep);
    font-weight: 650;
    font-size: 0.85rem;
    padding: 0.45rem 0.85rem;
  }

  button:hover:not(:disabled) {
    background: rgba(74, 222, 128, 0.2);
  }

  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  button.secondary {
    border-color: var(--line);
    background: transparent;
    color: var(--ink-muted);
  }

  code {
    font-size: 0.85em;
  }

  @media (max-width: 640px) {
    .weights {
      grid-template-columns: 1fr;
    }
  }
</style>
