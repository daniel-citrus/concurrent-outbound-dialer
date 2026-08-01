<script lang="ts">
	import "./app.css";
	import { onMount } from "svelte";
	import { createVisualizerStore } from "$lib/store.svelte";
	import SessionSetup from "$lib/components/SessionSetup.svelte";
	import SessionBar from "$lib/components/SessionBar.svelte";
	import ConcurrencyBoard from "$lib/components/ConcurrencyBoard.svelte";
	import SemaphoreBoard from "$lib/components/SemaphoreBoard.svelte";
	import ContactList from "$lib/components/ContactList.svelte";
	import WinnerPopup from "$lib/components/WinnerPopup.svelte";
	import AutoSimulatePanel from "$lib/components/AutoSimulatePanel.svelte";
	import AgentSessionView from "$lib/components/AgentSessionView.svelte";
	import MinimizedTool from "$lib/components/MinimizedTool.svelte";
	import { Alert, AlertDescription } from "$lib/components/ui/alert/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import Minimize2Icon from "@lucide/svelte/icons/minimize-2";
	import XIcon from "@lucide/svelte/icons/x";

	const store = createVisualizerStore();
	let phase = $state<"setup" | "session">("setup");
	let developerMode = $state(false);
	let minimized = $state(false);

	const showMinimized = $derived(minimized && phase === "session");

	onMount(() => {
		void store.refreshHealth();
		void store.refreshAutoSimulate();

		return () => store.stopPolling();
	});

	$effect(() => {
		if (developerMode) {
			void store.refreshAutoSimulate();

			return;
		}

		// Outside developer mode, keep auto-simulate on.
		void (async () => {
			await store.refreshAutoSimulate();

			if (store.autoSimulateAvailable && !store.autoSimulateEnabled) {
				await store.setAutoSimulate(true);
			}
		})();
	});

	function backToSetup() {
		minimized = false;
		store.reset();
		phase = "setup";
	}

	async function closeSession() {
		const session = store.session;
		if (
			session &&
			!["stopped", "completed", "failed"].includes(session.status)
		) {
			await store.stop();
		}
		backToSetup();
	}
</script>

<div
	class="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 py-7 {phase === 'session' &&
	!developerMode
		? 'h-full max-h-full overflow-hidden'
		: 'min-h-full'}"
	class:hidden={showMinimized}
>
	<header class="flex shrink-0 flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
				Concurrent outbound dialer
			</p>
			<h1 class="mt-1 text-[clamp(1.8rem,4vw,2.35rem)] font-bold tracking-tight">
				Visualizer
			</h1>
		</div>

		<div class="flex flex-col items-end gap-2.5">
			<div class="flex items-center gap-2">
				<Switch id="developer-mode" bind:checked={developerMode} size="sm" />
				<Label for="developer-mode" class="text-muted-foreground text-xs font-medium">
					Developer Mode
				</Label>
				{#if phase === "session"}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="text-muted-foreground"
						title="Minimize visualizer"
						aria-label="Minimize visualizer"
						onclick={() => (minimized = true)}
					>
						<Minimize2Icon class="size-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="text-muted-foreground hover:text-destructive"
						title="End session and close"
						aria-label="End session and close"
						disabled={store.busy}
						onclick={() => void closeSession()}
					>
						<XIcon class="size-4" />
					</Button>
				{/if}
			</div>

			{#if developerMode}
				<div
					class="flex items-center gap-2"
					class:opacity-45={!store.autoSimulateAvailable}
					title={store.autoSimulateAvailable
						? "When off, use the simulate panel to drive call statuses"
						: "Auto-simulate unavailable"}
				>
					<Switch
						id="auto-simulate"
						checked={store.autoSimulateEnabled}
						disabled={!store.autoSimulateAvailable || store.busy}
						size="sm"
						onCheckedChange={(checked) => void store.setAutoSimulate(checked)}
					/>
					<Label
						for="auto-simulate"
						class="text-muted-foreground text-xs font-medium {!store.autoSimulateAvailable
							? 'cursor-not-allowed'
							: ''}"
					>
						Auto-simulate
					</Label>
				</div>

				<div
					class="text-muted-foreground flex items-center gap-2 text-sm"
					class:text-primary={store.healthOk === true}
					class:text-destructive={store.healthOk === false}
				>
					<span
						class="size-2 rounded-full bg-muted-foreground"
						class:bg-primary={store.healthOk === true}
						class:bg-destructive={store.healthOk === false}
					></span>

					{#if store.healthOk === null}
						Checking API…
					{:else if store.healthOk}
						Backend connected{#if store.voiceProvider}
							· {store.voiceProvider} provider
						{/if}
					{:else}
						Backend unreachable — run
						<code class="font-mono text-[0.8em]">npm run dev</code>
						on :3000
					{/if}
				</div>
			{/if}
		</div>
	</header>

	{#if store.error}
		<Alert variant="destructive" class="border-destructive/35 bg-destructive/10 shrink-0">
			<AlertDescription>{store.error}</AlertDescription>
		</Alert>
	{/if}

	{#if phase === "setup"}
		<SessionSetup
			store={store}
			developerMode={developerMode}
			onCreated={() => (phase = "session")}
		/>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-4">
			<div class="flex shrink-0">
				<Button variant="link" class="text-muted-foreground h-auto p-0" onclick={backToSetup}>
					← New session
				</Button>
			</div>

			{#if developerMode}
				<SessionBar store={store} developerMode={developerMode} />
				<AutoSimulatePanel store={store} />
				<SemaphoreBoard store={store} />
				<ConcurrencyBoard store={store} developerMode={developerMode} />
				<ContactList store={store} developerMode={developerMode} />
			{:else}
				<div class="shrink-0">
					<SessionBar store={store} developerMode={developerMode} />
				</div>
				<div class="min-h-0 flex-1">
					<AgentSessionView store={store} />
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if phase === "session"}
	<WinnerPopup store={store} />
{/if}

{#if showMinimized}
	<MinimizedTool
		store={store}
		onExpand={() => (minimized = false)}
		onClose={() => void closeSession()}
	/>
{/if}
