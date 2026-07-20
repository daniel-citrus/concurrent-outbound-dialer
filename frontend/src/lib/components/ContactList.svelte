<script lang="ts">
	import type { VisualizerStore } from "$lib/store.svelte";
	import { resolveContactCallStatus } from "$lib/call-status-display";
	import * as Card from "$lib/components/ui/card/index.js";
	import * as Table from "$lib/components/ui/table/index.js";

	let {
		store,
		developerMode = false,
		compact = false,
		/** When true, only show contacts still waiting in the queue (conveyor belt). */
		queuedOnly = false,
	}: {
		store: VisualizerStore;
		developerMode?: boolean;
		compact?: boolean;
		queuedOnly?: boolean;
	} = $props();

	const sorted = $derived(
		[...store.contacts]
			.filter((contact) => !queuedOnly || contact.status === "queued")
			.sort((a, b) => a.position - b.position),
	);

	const showCallStatus = $derived(!queuedOnly);
</script>

<Card.Root class="min-h-0 rounded-none shadow-none ring-border {compact ? 'flex-1' : ''}">
	<Card.Header class={compact ? "shrink-0" : undefined}>
		<Card.Title>Contact batch</Card.Title>
		{#if !compact}
			<Card.Description>Durable queue order from PostgreSQL.</Card.Description>
		{/if}
	</Card.Header>

	<Card.Content class={compact ? "flex min-h-0 flex-1 flex-col" : undefined}>
		<div
			class="overflow-auto {compact
				? 'min-h-0 flex-1'
				: 'max-h-[22rem]'}"
		>
			<Table.Root class={compact ? "min-w-0 text-sm" : "min-w-[880px] text-sm"}>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						{#if developerMode}
							<Table.Head class="bg-card sticky top-0">#</Table.Head>
						{/if}
						<Table.Head class="bg-card sticky top-0">Name</Table.Head>
						<Table.Head class="bg-card sticky top-0">Company</Table.Head>
						<Table.Head class="bg-card sticky top-0">Title</Table.Head>
						{#if showCallStatus}
							<Table.Head class="bg-card sticky top-0">Call status</Table.Head>
						{/if}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if sorted.length === 0}
						<Table.Row>
							<Table.Cell
								colspan={developerMode ? (showCallStatus ? 5 : 4) : showCallStatus ? 4 : 3}
								class="text-muted-foreground"
							>
								{#if queuedOnly}
									No contacts waiting — all have moved to dialing or terminal.
								{:else}
									No contacts in this session.
								{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each sorted as contact (contact.id)}
							{@const detail = store.getContactDetail(contact.externalContactId)}
							{@const callStatus = resolveContactCallStatus(contact.id, store.calls)}
							<Table.Row>
								{#if developerMode}
									<Table.Cell class="font-mono">{contact.position}</Table.Cell>
								{/if}
								<Table.Cell class="font-semibold">{detail.name}</Table.Cell>
								<Table.Cell>{detail.company}</Table.Cell>
								<Table.Cell>{detail.title}</Table.Cell>
								{#if showCallStatus}
									<Table.Cell class="call-status" data-tone={callStatus.tone}>
										{callStatus.label}
									</Table.Cell>
								{/if}
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</div>
	</Card.Content>
</Card.Root>
