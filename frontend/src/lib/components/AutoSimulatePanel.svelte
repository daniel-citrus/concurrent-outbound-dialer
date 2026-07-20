<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import type { VisualizerStore } from "$lib/store.svelte";
	import type { MockAutoSimulateConfig } from "$lib/types";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Card from "$lib/components/ui/card/index.js";
	import * as Collapsible from "$lib/components/ui/collapsible/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Slider } from "$lib/components/ui/slider/index.js";

	let { store }: { store: VisualizerStore } = $props();

	let draft = $state<MockAutoSimulateConfig | null>(null);
	let open = $state(true);

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

	function updateNumber(key: keyof MockAutoSimulateConfig, raw: string | number) {
		if (!draft) return;
		const value = typeof raw === "number" ? raw : Number(raw);
		if (Number.isNaN(value)) return;
		draft = { ...draft, [key]: value };
	}
</script>

<Collapsible.Root bind:open class="group">
	<Card.Root class="rounded-none shadow-none ring-border gap-0 py-0">
		<Collapsible.Trigger
			class="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
		>
			<span class="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-1">
				<span class="text-[1.05rem] font-semibold tracking-tight">Auto-simulate settings</span>
				<span class="text-muted-foreground font-mono text-xs">
					{#if !available}
						unavailable
					{:else if store.autoSimulateEnabled}
						on · {Math.round((config?.answerRate ?? 0) * 100)}% answer
					{:else}
						paused
					{/if}
				</span>
			</span>
			<ChevronDownIcon
				class="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
			/>
		</Collapsible.Trigger>

		<Collapsible.Content>
			<div class="border-border grid gap-3.5 border-t px-4 py-4">
				{#if !available}
					<p class="text-muted-foreground text-sm">
						Set <code class="font-mono text-[0.85em]">MOCK_AUTO_SIMULATE=true</code> on the API to
						configure.
					</p>
				{:else if draft}
					<p class="text-muted-foreground text-sm">
						Applies to new status steps immediately. Turn off Auto-simulate above to drive calls
						manually.
					</p>

					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<div class="grid gap-1.5 sm:col-span-2 lg:col-span-1">
							<Label class="text-muted-foreground text-xs">Answer rate</Label>
							<div class="flex items-center gap-2.5">
								<Slider
									type="single"
									value={draft.answerRate}
									min={0}
									max={1}
									step={0.05}
									disabled={store.busy}
									class="flex-1"
									onValueChange={(value) => updateNumber("answerRate", value)}
								/>
								<span class="min-w-11 text-right font-mono text-sm">
									{Math.round(draft.answerRate * 100)}%
								</span>
							</div>
						</div>

						<div class="grid gap-1.5">
							<Label class="text-muted-foreground text-xs">Step delay min (ms)</Label>
							<Input
								type="number"
								min="0"
								step="50"
								value={draft.minStepMs}
								disabled={store.busy}
								oninput={(e) => updateNumber("minStepMs", e.currentTarget.value)}
							/>
						</div>

						<div class="grid gap-1.5">
							<Label class="text-muted-foreground text-xs">Step delay max (ms)</Label>
							<Input
								type="number"
								min="0"
								step="50"
								value={draft.maxStepMs}
								disabled={store.busy}
								oninput={(e) => updateNumber("maxStepMs", e.currentTarget.value)}
							/>
						</div>

						<div class="grid gap-1.5">
							<Label class="text-muted-foreground text-xs">Talk time min (ms)</Label>
							<Input
								type="number"
								min="0"
								step="100"
								value={draft.minTalkMs}
								disabled={store.busy}
								oninput={(e) => updateNumber("minTalkMs", e.currentTarget.value)}
							/>
						</div>

						<div class="grid gap-1.5">
							<Label class="text-muted-foreground text-xs">Talk time max (ms)</Label>
							<Input
								type="number"
								min="0"
								step="100"
								value={draft.maxTalkMs}
								disabled={store.busy}
								oninput={(e) => updateNumber("maxTalkMs", e.currentTarget.value)}
							/>
						</div>
					</div>

					<p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
						Non-answer outcome weights
					</p>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div class="grid gap-1.5">
							<Label class="text-muted-foreground text-xs">Busy</Label>
							<Input
								type="number"
								min="0"
								step="0.5"
								value={draft.busyWeight}
								disabled={store.busy}
								oninput={(e) => updateNumber("busyWeight", e.currentTarget.value)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label class="text-muted-foreground text-xs">Failed</Label>
							<Input
								type="number"
								min="0"
								step="0.5"
								value={draft.failedWeight}
								disabled={store.busy}
								oninput={(e) => updateNumber("failedWeight", e.currentTarget.value)}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label class="text-muted-foreground text-xs">No answer</Label>
							<Input
								type="number"
								min="0"
								step="0.5"
								value={draft.noAnswerWeight}
								disabled={store.busy}
								oninput={(e) => updateNumber("noAnswerWeight", e.currentTarget.value)}
							/>
						</div>
					</div>

					<div class="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={store.busy}
							onclick={() => void resetDefaults()}
						>
							Reset defaults
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={store.busy || !dirty}
							onclick={() => void save()}
						>
							Apply
						</Button>
					</div>
				{/if}
			</div>
		</Collapsible.Content>
	</Card.Root>
</Collapsible.Root>
