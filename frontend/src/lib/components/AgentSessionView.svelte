<script lang="ts">
	import type { VisualizerStore } from "$lib/store.svelte";
	import ContactList from "$lib/components/ContactList.svelte";
	import ConcurrencyBoard from "$lib/components/ConcurrencyBoard.svelte";
	import TerminalCalls from "$lib/components/TerminalCalls.svelte";

	let { store }: { store: VisualizerStore } = $props();
</script>

<section
	class="grid h-full min-h-0 grid-cols-1 grid-rows-3 gap-4 xl:grid-cols-3 xl:grid-rows-1"
>
	<div class="flex min-h-0 min-w-0 flex-col">
		<ContactList {store} developerMode={false} compact queuedOnly />
	</div>
	<div class="flex min-h-0 min-w-0 flex-col">
		<ConcurrencyBoard {store} developerMode={false} title="Dialing" compact />
	</div>
	<div class="flex min-h-0 min-w-0 flex-col">
		<TerminalCalls {store} />
	</div>
</section>
