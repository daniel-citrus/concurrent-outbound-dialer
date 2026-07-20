<script lang="ts">
	import type { VisualizerStore } from "$lib/store.svelte";
	import { callStatusTone } from "$lib/call-status-display";
	import { formatStatus, isActiveCall } from "$lib/types";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";

	let { store }: { store: VisualizerStore } = $props();

	/** Current-round winner only — never fall back to historical isWinner rows. */
	const winner = $derived.by(() => {
		const winnerId = store.session?.winningCallAttemptId;
		if (!winnerId) return null;

		const fromCalls = store.calls.find((call) => call.id === winnerId);
		if (fromCalls) return fromCalls;

		const fromSnapshot = store.snapshot?.winningCall;
		if (fromSnapshot?.id === winnerId) return fromSnapshot;

		return null;
	});

	const open = $derived(
		!!winner &&
			store.session?.status === "winner_selected" &&
			isActiveCall(winner.status),
	);

	const detail = $derived(
		winner ? store.getContactDetailByContactId(winner.contactId) : null,
	);

	const contact = $derived(
		winner ? store.contacts.find((c) => c.id === winner.contactId) : null,
	);

	const canHangUp = $derived(!!winner && isActiveCall(winner.status));

	async function hangUp() {
		if (!winner || !canHangUp) return;
		await store.simulate(winner.id, "completed");
	}
</script>

<Dialog.Root open={open} onOpenChange={() => {}}>
	{#if open && winner}
		<Dialog.Content
			showCloseButton={false}
			class="rounded-none border border-[color-mix(in_oklab,var(--status-win)_40%,transparent)] ring-0 sm:max-w-md"
			interactOutsideBehavior="ignore"
			escapeKeydownBehavior="ignore"
		>
			<p class="text-[0.72rem] font-bold tracking-[0.08em] text-[var(--status-win)] uppercase">
				Connected
			</p>
			<Dialog.Title class="mt-1 text-[1.35rem] font-bold tracking-tight">
				{detail?.name || "Unknown contact"}
			</Dialog.Title>
			<p class="mt-1 font-mono text-[1.05rem] font-semibold">
				{contact?.phoneNumber || "—"}
			</p>
			<Dialog.Description class="text-muted-foreground mt-1 text-sm">
				{detail?.company || "—"}
				{#if detail?.title}
					· {detail.title}
				{/if}
			</Dialog.Description>
			<p class="mt-3 text-sm">
				<span
					class="call-status"
					data-tone={callStatusTone(winner.status, { isWinner: true })}
				>
					{formatStatus(winner.status)}
				</span>
			</p>

			<Dialog.Footer class="mt-4">
				<Button
					type="button"
					variant="destructive"
					disabled={store.busy || !canHangUp}
					onclick={() => void hangUp()}
				>
					Hang up
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	{/if}
</Dialog.Root>
