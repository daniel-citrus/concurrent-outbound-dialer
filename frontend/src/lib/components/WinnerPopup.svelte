<script lang="ts">
	import type { VisualizerStore } from "$lib/store.svelte";
	import BrowserCallDialer from "$lib/components/BrowserCallDialer.svelte";

	let { store }: { store: VisualizerStore } = $props();
</script>

<BrowserCallDialer {store} />
