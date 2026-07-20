<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import type { VisualizerStore } from "$lib/store.svelte";
	import { callStatusTone } from "$lib/call-status-display";
	import { formatStatus } from "$lib/types";
	import * as Card from "$lib/components/ui/card/index.js";
	import * as Collapsible from "$lib/components/ui/collapsible/index.js";
	import * as Table from "$lib/components/ui/table/index.js";

	let { store }: { store: VisualizerStore } = $props();

	const runtime = $derived(store.runtime);

	const permitSlots = $derived.by(() => {
		if (!runtime) {
			return [];
		}

		const slots: Array<"held" | "open"> = [];
		for (let i = 0; i < runtime.semaphore.occupiedPermits; i += 1) {
			slots.push("held");
		}
		for (let i = 0; i < runtime.semaphore.availablePermits; i += 1) {
			slots.push("open");
		}
		return slots;
	});

	const summaryLine = $derived.by(() => {
		if (!runtime) {
			return "Runtime unavailable";
		}

		const { semaphore } = runtime;
		return `${semaphore.occupiedPermits}/${semaphore.capacity} held · ${semaphore.availablePermits} open`;
	});
</script>

<Collapsible.Root class="group">
	<Card.Root class="rounded-none shadow-none ring-border gap-0 py-0">
		<Collapsible.Trigger
			class="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
		>
			<span class="grid min-w-0 gap-0.5">
				<span class="text-[1.05rem] font-semibold tracking-tight">Semaphore</span>
				<span class="text-muted-foreground truncate font-mono text-xs">{summaryLine}</span>
			</span>
			<ChevronDownIcon
				class="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
			/>
		</Collapsible.Trigger>

		<Collapsible.Content>
			<div class="border-border grid gap-4 border-t px-5 py-4">
				<p class="text-muted-foreground text-sm">
					In-memory admission control for this session controller.
				</p>

				{#if !runtime}
					<p class="text-muted-foreground text-sm">Runtime snapshot unavailable.</p>
				{:else}
					<div class="grid gap-2">
						<div class="text-muted-foreground flex items-baseline justify-between gap-3 text-[0.72rem] font-bold tracking-wide uppercase">
							<span>Permits</span>
							<span class="text-xs font-medium normal-case tracking-normal">
								filled slots hold a permit
							</span>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each permitSlots as slot, index (index)}
								<div
									class="size-10 border transition-colors {slot === 'held'
										? 'border-primary bg-gradient-to-b from-primary/35 to-primary/15'
										: 'border-border opacity-75 border-dashed bg-transparent'}"
									title={slot === "held" ? "Permit held" : "Permit available"}
								></div>
							{/each}
						</div>
					</div>

					<div class="grid gap-2">
						<div class="text-muted-foreground flex items-baseline justify-between gap-3 text-[0.72rem] font-bold tracking-wide uppercase">
							<span>Resources</span>
							<span class="text-xs font-medium normal-case tracking-normal">
								active calls holding permits
							</span>
						</div>

						{#if runtime.resources.length === 0}
							<p class="text-muted-foreground py-1 text-sm">No permits currently held.</p>
						{:else}
							<div class="max-h-56 overflow-auto">
								<Table.Root class="text-[0.86rem]">
									<Table.Header>
										<Table.Row class="hover:bg-transparent">
											<Table.Head class="bg-card sticky top-0">Call attempt</Table.Head>
											<Table.Head class="bg-card sticky top-0">Contact</Table.Head>
											<Table.Head class="bg-card sticky top-0">Phone</Table.Head>
											<Table.Head class="bg-card sticky top-0">Call status</Table.Head>
											<Table.Head class="bg-card sticky top-0">Permit</Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each runtime.resources as resource (resource.callAttemptId)}
											<Table.Row class={resource.permitReleased ? "opacity-55" : ""}>
												<Table.Cell class="font-mono">
													{resource.callAttemptId.slice(0, 8)}
												</Table.Cell>
												<Table.Cell>
													{resource.contactId
														? store.getContactDetailByContactId(resource.contactId).name
														: "—"}
												</Table.Cell>
												<Table.Cell class="font-mono">
													{resource.phoneNumber ?? "—"}
												</Table.Cell>
												<Table.Cell
													class="call-status"
													data-tone={resource.callStatus
														? callStatusTone(resource.callStatus)
														: "neutral"}
												>
													{resource.callStatus
														? formatStatus(resource.callStatus)
														: "—"}
												</Table.Cell>
												<Table.Cell>
													{resource.permitReleased ? "released" : "held"}
												</Table.Cell>
											</Table.Row>
										{/each}
									</Table.Body>
								</Table.Root>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</Collapsible.Content>
	</Card.Root>
</Collapsible.Root>
