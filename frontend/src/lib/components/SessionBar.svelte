<script lang="ts">
	import type { VisualizerStore } from "$lib/store.svelte";
	import { formatStatus } from "$lib/types";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Card from "$lib/components/ui/card/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";

	let {
		store,
		developerMode = false,
	}: { store: VisualizerStore; developerMode?: boolean } = $props();

	const session = $derived(store.session);
	const snapshot = $derived(store.snapshot);

	const showStart = $derived(
		!!session &&
			(session.status === "created" ||
				(session.status === "winner_selected" &&
					(snapshot?.queuedContactCount ?? 0) > 0)),
	);

	const startDisabled = $derived(
		store.busy || (snapshot?.activeCallCount ?? 0) > 0,
	);

	const canPause = $derived(session?.status === "running");
	const canResume = $derived(session?.status === "paused");
	const canStop = $derived(
		!!session && !["stopped", "completed", "failed"].includes(session.status),
	);

	const canToggleAutoContinue = $derived(
		!!session && !["stopped", "completed", "failed"].includes(session.status),
	);

	const statusClass = $derived.by(() => {
		const status = session?.status;
		if (status === "running") return "text-primary";
		if (status === "winner_selected") return "text-[var(--status-win)]";
		if (status === "paused" || status === "stopping") return "text-[var(--status-warn)]";
		if (status === "failed") return "text-destructive";
		return "";
	});
</script>

{#if session}
	<Card.Root class="rounded-none shadow-none ring-border">
		<Card.Content
			class="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))_auto]"
		>
			<div>
				<p class="text-muted-foreground text-[0.7rem] font-semibold tracking-wider uppercase">
					Agent
				</p>
				<p class="mt-1 text-[1.05rem] font-semibold">{store.agentLabel ?? session.agentId}</p>
				{#if developerMode}
					<p class="text-muted-foreground mt-0.5 font-mono text-xs break-all">{session.id}</p>
				{/if}
			</div>

			<div>
				<p class="text-muted-foreground text-[0.7rem] font-semibold tracking-wider uppercase">
					Status
				</p>
				<p class="mt-1 text-[1.05rem] font-semibold capitalize {statusClass}">
					{formatStatus(session.status)}
				</p>
			</div>

			<div>
				<p class="text-muted-foreground text-[0.7rem] font-semibold tracking-wider uppercase">
					Active / limit
				</p>
				<p class="mt-1 font-mono text-[1.05rem] font-semibold">
					{snapshot?.activeCallCount ?? 0}/{session.concurrencyLimit}
				</p>
			</div>

			<div>
				<p class="text-muted-foreground text-[0.7rem] font-semibold tracking-wider uppercase">
					Queued
				</p>
				<p class="mt-1 font-mono text-[1.05rem] font-semibold">
					{snapshot?.queuedContactCount ?? "—"}
				</p>
			</div>

			<div class="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
				{#if canToggleAutoContinue}
					<div
						class="flex items-center gap-2"
						title="When enabled, dialing resumes automatically after a winning call ends"
					>
						<Switch
							id="auto-continue"
							checked={session.autoContinue}
							disabled={store.busy}
							size="sm"
							onCheckedChange={(checked) => void store.setAutoContinue(checked)}
						/>
						<Label for="auto-continue" class="text-muted-foreground text-xs font-semibold">
							Auto-continue
						</Label>
					</div>
				{/if}
				{#if showStart}
					<Button
						type="button"
						size="sm"
						disabled={startDisabled}
						title={startDisabled ? "Finish the current call before starting" : undefined}
						onclick={() => store.start()}
					>
						Start
					</Button>
				{/if}
				{#if canPause}
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={store.busy}
						onclick={() => store.pause()}
					>
						Pause
					</Button>
				{/if}
				{#if canResume}
					<Button
						type="button"
						size="sm"
						disabled={store.busy}
						onclick={() => store.resume()}
					>
						Resume
					</Button>
				{/if}
				{#if canStop}
					<Button
						type="button"
						variant="destructive"
						size="sm"
						disabled={store.busy}
						onclick={() => store.stop()}
					>
						Stop
					</Button>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>
{/if}
