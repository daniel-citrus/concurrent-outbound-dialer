<script lang="ts">
	import type { VisualizerStore } from "$lib/store.svelte";
	import { callStatusTone } from "$lib/call-status-display";
	import { formatStatus, isActiveCall } from "$lib/types";
	import * as Card from "$lib/components/ui/card/index.js";
	import * as Table from "$lib/components/ui/table/index.js";

	let { store }: { store: VisualizerStore } = $props();

	const terminalCalls = $derived(
		[...store.calls]
			.filter((call) => !isActiveCall(call.status))
			.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			),
	);
</script>

<Card.Root class="min-h-0 flex-1 rounded-none shadow-none ring-border">
	<Card.Header class="shrink-0">
		<Card.Title>Terminal calls</Card.Title>
	</Card.Header>

	<Card.Content class="flex min-h-0 flex-1 flex-col">
		<div class="min-h-0 flex-1 overflow-auto">
			<Table.Root class="min-w-0 text-sm">
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head class="bg-card sticky top-0">Name</Table.Head>
						<Table.Head class="bg-card sticky top-0">Company</Table.Head>
						<Table.Head class="bg-card sticky top-0">Outcome</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if terminalCalls.length === 0}
						<Table.Row>
							<Table.Cell colspan={3} class="text-muted-foreground">
								No terminal calls yet.
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each terminalCalls as call (call.id)}
							{@const detail = store.getContactDetailByContactId(call.contactId)}
							{@const contact = store.contacts.find((c) => c.id === call.contactId)}
							{@const tone = callStatusTone(call.status, { isWinner: call.isWinner })}
							{@const name =
								(detail.name || "").trim() ||
								contact?.externalContactId ||
								"Unknown contact"}
							{@const company = (detail.company || "").trim() || "—"}
							<Table.Row data-tone={tone}>
								<Table.Cell class="font-semibold">{name}</Table.Cell>
								<Table.Cell>{company}</Table.Cell>
								<Table.Cell class="status-cell capitalize" data-tone={tone}>
									{call.isWinner && call.status === "completed"
										? "winner"
										: formatStatus(call.status)}
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</div>
	</Card.Content>
</Card.Root>
