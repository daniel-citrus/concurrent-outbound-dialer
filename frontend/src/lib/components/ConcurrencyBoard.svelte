<script lang="ts">
	import type { CallAttempt, CallAttemptStatus } from "$lib/types";
	import { callStatusTone } from "$lib/call-status-display";
	import { formatStatus, isActiveCall } from "$lib/types";
	import type { VisualizerStore } from "$lib/store.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Card from "$lib/components/ui/card/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import * as Table from "$lib/components/ui/table/index.js";

	let {
		store,
		developerMode = false,
		title = "Concurrency board",
		compact = false,
	}: {
		store: VisualizerStore;
		developerMode?: boolean;
		title?: string;
		compact?: boolean;
	} = $props();

	let selectedIds = $state<string[]>([]);

	const session = $derived(store.session);
	const activeCalls = $derived(store.calls.filter((c) => isActiveCall(c.status)));
	const simulatable = $derived(
		store.calls.filter((c) => isActiveCall(c.status) && !c.isWinner),
	);
	const simulatableIds = $derived(simulatable.map((c) => c.id));
	const limit = $derived(session?.concurrencyLimit ?? 0);

	$effect(() => {
		const allowed = new Set(simulatableIds);
		const next = selectedIds.filter((id) => allowed.has(id));
		if (next.length !== selectedIds.length) {
			selectedIds = next;
		}
	});

	const selectedCount = $derived(selectedIds.length);
	const allSelected = $derived(
		simulatableIds.length > 0 && selectedCount === simulatableIds.length,
	);

	const slots = $derived.by(() => {
		const filled = activeCalls.slice(0, limit);
		const empties = compact ? 0 : Math.max(0, limit - filled.length);
		return { filled, empties };
	});

	const quickActions: CallAttemptStatus[] = [
		"ringing",
		"in_progress",
		"no_answer",
		"busy",
		"failed",
	];

	function slotTone(call: CallAttempt): string {
		return callStatusTone(call.status, { isWinner: call.isWinner });
	}

	function statusLabel(call: CallAttempt): string {
		if (call.isWinner) return "winner";
		return formatStatus(call.status);
	}

	function isSelected(id: string): boolean {
		return selectedIds.includes(id);
	}

	function toggleSelected(id: string) {
		if (selectedIds.includes(id)) {
			selectedIds = selectedIds.filter((x) => x !== id);
		} else {
			selectedIds = [...selectedIds, id];
		}
	}

	function selectAll() {
		selectedIds = [...simulatableIds];
	}

	function clearSelection() {
		selectedIds = [];
	}

	async function applySelected(status: CallAttemptStatus) {
		await store.simulateMany(selectedIds, status);
		clearSelection();
	}

	function rowToneClass(tone: string): string {
		const map: Record<string, string> = {
			dialing: "shadow-[inset_4px_0_0_var(--status-done)]",
			ringing: "animate-pulse shadow-[inset_4px_0_0_var(--status-ring)]",
			answered: "shadow-[inset_4px_0_0_var(--status-win)]",
			winner: "shadow-[inset_4px_0_0_var(--status-win)]",
			open: "opacity-70 shadow-[inset_4px_0_0_color-mix(in_oklab,var(--border)_70%,transparent)]",
		};
		return map[tone] ?? "shadow-[inset_4px_0_0_var(--status-slot)]";
	}
</script>

<section class={compact ? "flex min-h-0 flex-1 flex-col" : "grid gap-4"}>
	{#if developerMode && simulatable.length > 0}
		<Card.Root class="rounded-none shadow-none ring-border">
			<Card.Content class="grid gap-3">
				<div class="text-muted-foreground flex items-baseline justify-between gap-3 text-[0.72rem] font-bold tracking-wide uppercase">
					<span>Simulate</span>
					<span class="font-mono font-semibold normal-case tracking-normal">
						{selectedCount} selected · {simulatable.length} active
					</span>
				</div>

				<div class="flex gap-3">
					<Button
						type="button"
						variant="link"
						class="h-auto p-0 text-sm"
						disabled={store.busy || allSelected}
						onclick={selectAll}
					>
						Select all
					</Button>
					<Button
						type="button"
						variant="link"
						class="h-auto p-0 text-sm"
						disabled={store.busy || selectedCount === 0}
						onclick={clearSelection}
					>
						Clear
					</Button>
				</div>

				<div class="grid gap-1.5">
					<p class="text-muted-foreground text-[0.72rem] font-bold tracking-wide uppercase">
						Selected →
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each quickActions as status}
							<Button
								type="button"
								variant="outline"
								size="xs"
								class={status === "in_progress"
									? "border-[color-mix(in_oklab,var(--status-win)_45%,transparent)] text-[var(--status-win)]"
									: ""}
								disabled={store.busy || selectedCount === 0}
								onclick={() => applySelected(status)}
							>
								{formatStatus(status)}
							</Button>
						{/each}
					</div>
				</div>

				<div class="grid gap-1.5">
					<p class="text-muted-foreground text-[0.72rem] font-bold tracking-wide uppercase">
						All active →
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each quickActions as status}
							<Button
								type="button"
								variant="outline"
								size="xs"
								class={status === "in_progress"
									? "border-[color-mix(in_oklab,var(--status-win)_45%,transparent)] text-[var(--status-win)]"
									: ""}
								disabled={store.busy}
								onclick={() => store.simulateAllActive(status)}
							>
								{formatStatus(status)}
							</Button>
						{/each}
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root class="min-h-0 rounded-none shadow-none ring-border {compact ? 'flex-1' : ''}">
		<Card.Header class={compact ? "shrink-0" : undefined}>
			<Card.Title>{title}</Card.Title>
			{#if !compact}
				<Card.Description>
					{#if developerMode}
						Select calls with the checkboxes, then apply a status from the simulate panel.
					{:else}
						Live dialing slots for the current session.
					{/if}
				</Card.Description>
			{/if}
		</Card.Header>

		<Card.Content class={compact ? "flex min-h-0 flex-1 flex-col" : undefined}>
			<div
				class="overflow-auto {compact ? 'min-h-0 flex-1' : 'max-h-[22rem]'}"
			>
				<Table.Root class={compact ? "min-w-0 text-sm" : "min-w-[880px] text-sm"}>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							{#if developerMode}
								<Table.Head class="bg-card sticky top-0 w-8"></Table.Head>
								<Table.Head class="bg-card sticky top-0">Slot</Table.Head>
							{/if}
							<Table.Head class="bg-card sticky top-0">Call status</Table.Head>
							<Table.Head class="bg-card sticky top-0">Name</Table.Head>
							<Table.Head class="bg-card sticky top-0">Company</Table.Head>
							<Table.Head class="bg-card sticky top-0">Title</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each slots.filled as call, index (call.id)}
							{@const canSelect =
								developerMode && isActiveCall(call.status) && !call.isWinner}
							{@const detail = store.getContactDetailByContactId(call.contactId)}
							{@const tone = slotTone(call)}
							<Table.Row
								class="{rowToneClass(tone)} {canSelect && isSelected(call.id)
									? 'bg-primary/10'
									: ''}"
								data-tone={tone}
								data-state={canSelect && isSelected(call.id) ? "selected" : undefined}
							>
								{#if developerMode}
									<Table.Cell class="w-8 pl-1.5">
										{#if canSelect}
											<Checkbox
												checked={isSelected(call.id)}
												disabled={store.busy}
												onCheckedChange={() => toggleSelected(call.id)}
											/>
										{/if}
									</Table.Cell>
									<Table.Cell class="font-mono">{index + 1}</Table.Cell>
								{/if}
								<Table.Cell
									class="status-cell"
									data-tone={callStatusTone(call.status, { isWinner: call.isWinner })}
								>
									{statusLabel(call)}
								</Table.Cell>
								<Table.Cell class="font-semibold">{detail.name}</Table.Cell>
								<Table.Cell>{detail.company}</Table.Cell>
								<Table.Cell>{detail.title}</Table.Cell>
							</Table.Row>
						{/each}

						{#each Array(slots.empties) as _, index (index)}
							<Table.Row class="{rowToneClass('open')} border-dashed" data-tone="open">
								{#if developerMode}
									<Table.Cell class="w-8"></Table.Cell>
									<Table.Cell class="font-mono">{slots.filled.length + index + 1}</Table.Cell>
								{/if}
								<Table.Cell class="status-cell" data-tone="open">open permit</Table.Cell>
								<Table.Cell colspan={3} class="text-muted-foreground">
									Waiting for next claim
								</Table.Cell>
							</Table.Row>
						{/each}

						{#if compact && slots.filled.length === 0}
							<Table.Row>
								<Table.Cell colspan={4} class="text-muted-foreground">
									No contacts dialing.
								</Table.Cell>
							</Table.Row>
						{/if}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>
</section>
