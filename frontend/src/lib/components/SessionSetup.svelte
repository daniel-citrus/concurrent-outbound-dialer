<script lang="ts">
	import { onMount } from "svelte";
	import { dialerApi } from "$lib/api";
	import { formatActivity, formatTimeAgo } from "$lib/contact-display";
	import type { VisualizerStore } from "$lib/store.svelte";
	import { formatStatus, nebulaUserDisplayName } from "$lib/types";
	import type {
		NebulaProspectContact,
		NebulaProspectList,
		NebulaUser,
	} from "$lib/types";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Card from "$lib/components/ui/card/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import * as Table from "$lib/components/ui/table/index.js";

	let {
		store,
		developerMode = false,
		onCreated,
	}: {
		store: VisualizerStore;
		developerMode?: boolean;
		onCreated: () => void;
	} = $props();

	const clientId = `client-${Math.random().toString(36).slice(2, 7)}`;
	let agentId = $state("");
	let prospectListId = $state("");
	let nebulaUsers = $state<NebulaUser[]>([]);
	let prospectLists = $state<NebulaProspectList[]>([]);
	let nebulaConfigured = $state(false);
	let nebulaUsersLoading = $state(true);
	let prospectListsLoading = $state(false);
	let prospectContactsLoading = $state(false);
	let contactBatchNote = $state("");
	let concurrencyLimit = $state(4);
	let selectedContacts = $state<NebulaProspectContact[]>([]);

	const selectClass =
		"border-input bg-transparent dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2.5 py-1 font-mono text-sm shadow-xs outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

	onMount(() => {
		void loadNebulaUsers();
	});

	$effect(() => {
		const selectedAgentId = agentId;
		if (!selectedAgentId) {
			prospectLists = [];
			prospectListId = "";
			selectedContacts = [];
			return;
		}

		void loadProspectLists(selectedAgentId);
	});

	async function loadNebulaUsers() {
		nebulaUsersLoading = true;
		try {
			const response = await dialerApi.getNebulaUsers();
			nebulaConfigured = response.configured;
			nebulaUsers = response.users;
			if (response.users.length > 0 && !agentId) {
				agentId = response.users[0]!.id;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to load Nebula users";
			store.setError(message);
		} finally {
			nebulaUsersLoading = false;
		}
	}

	async function loadProspectLists(selectedAgentId: string) {
		prospectListsLoading = true;
		prospectListId = "";
		selectedContacts = [];
		contactBatchNote = "";
		try {
			const response = await dialerApi.getAgentProspectLists(selectedAgentId);
			prospectLists = response.lists;
		} catch (error) {
			prospectLists = [];
			const message =
				error instanceof Error ? error.message : "Failed to load prospect lists";
			store.setError(message);
		} finally {
			prospectListsLoading = false;
		}
	}

	async function onProspectListChange(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const listId = select.value;
		prospectListId = listId;
		contactBatchNote = "";

		if (!listId) {
			selectedContacts = [];
			return;
		}

		prospectContactsLoading = true;
		try {
			const response = await dialerApi.getProspectListContacts(listId);
			selectedContacts = response.contacts;

			const loaded = response.contacts.length;
			if (loaded === 0) {
				contactBatchNote = "No dialable contacts with phone numbers in this list.";
			} else if (response.skippedWithoutPhone > 0) {
				contactBatchNote = `Loaded ${loaded} contacts (${response.skippedWithoutPhone} skipped without a phone number).`;
			} else {
				contactBatchNote = `Loaded ${loaded} contacts from the selected list.`;
			}
		} catch (error) {
			selectedContacts = [];
			const message =
				error instanceof Error ? error.message : "Failed to load prospect list contacts";
			store.setError(message);
		} finally {
			prospectContactsLoading = false;
		}
	}

	async function submit(event: Event) {
		event.preventDefault();
		const contacts = selectedContacts.map((contact) => ({
			externalContactId: contact.externalContactId,
			phoneNumber: contact.phoneNumber,
		}));

		if (contacts.length === 0) {
			store.setError("Select a prospect list or add at least one contact as externalId,+E164");
			return;
		}

		if (!agentId.trim()) {
			store.setError("Select a Nebula agent");
			return;
		}

		const selectedAgent = nebulaUsers.find((user) => user.id === agentId.trim());

		await store.createAndLoad({
			clientId,
			agentId: agentId.trim(),
			agentLabel: selectedAgent
				? nebulaUserDisplayName(selectedAgent)
				: agentId.trim(),
			concurrencyLimit,
			contacts,
			contactDetails: selectedContacts,
		});

		if (store.session) onCreated();
	}
</script>

<form class="grid gap-5" onsubmit={submit}>
	<Card.Root class="rounded-none shadow-none ring-border">
		<Card.Header>
			<Card.Title>New session</Card.Title>
			{#if developerMode}
				<Card.Description>One ordered contact batch. Mock provider — no real Twilio calls.</Card.Description>
			{/if}
		</Card.Header>

		<Card.Content class="grid gap-5">
			<div class="grid gap-3.5 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label class="text-muted-foreground text-[0.78rem] tracking-wide uppercase">
						Agent
					</Label>
					<select
						class={selectClass}
						bind:value={agentId}
						required
						disabled={nebulaUsersLoading || nebulaUsers.length === 0}
					>
						{#if nebulaUsersLoading}
							<option value="">Loading Nebula users…</option>
						{:else if !nebulaConfigured}
							<option value="">Nebula not configured</option>
						{:else if nebulaUsers.length === 0}
							<option value="">No agents with prospect lists</option>
						{:else}
							{#each nebulaUsers as user (user.id)}
								<option value={user.id}>{user.label}</option>
							{/each}
						{/if}
					</select>
				</div>

				<div class="grid gap-1.5">
					<Label class="text-muted-foreground text-[0.78rem] tracking-wide uppercase">
						Prospect list
					</Label>
					<select
						class={selectClass}
						value={prospectListId}
						onchange={onProspectListChange}
						disabled={prospectListsLoading ||
							prospectContactsLoading ||
							!agentId ||
							prospectLists.length === 0}
					>
						{#if !agentId}
							<option value="">Select an agent first</option>
						{:else if prospectListsLoading}
							<option value="">Loading prospect lists…</option>
						{:else if prospectLists.length === 0}
							<option value="">No prospect lists for this agent</option>
						{:else}
							<option value="">Select a prospect list</option>
							{#each prospectLists as list (list.id)}
								<option value={list.id}>{list.label}</option>
							{/each}
						{/if}
					</select>
				</div>

				<div class="grid gap-1.5">
					<Label class="text-muted-foreground text-[0.78rem] tracking-wide uppercase">
						Concurrency (1–15)
					</Label>
					<Input type="number" min="1" max="15" bind:value={concurrencyLimit} required />
				</div>
			</div>

			<div class="grid gap-2">
				<div class="text-sm font-semibold">
					Contacts
					<span class="text-muted-foreground ml-1.5 font-normal">
						{#if prospectContactsLoading}
							Loading from prospect list…
						{:else}
							Loaded from the selected prospect list
						{/if}
					</span>
				</div>

				{#if contactBatchNote}
					<p class="text-primary text-sm">{contactBatchNote}</p>
				{/if}

				<div class="border-border max-h-[26rem] overflow-auto border">
					<Table.Root class="min-w-[880px]">
						<Table.Header>
							<Table.Row class="hover:bg-transparent">
								<Table.Head class="bg-card sticky top-0">Name</Table.Head>
								<Table.Head class="bg-card sticky top-0">Company</Table.Head>
								<Table.Head class="bg-card sticky top-0">Title</Table.Head>
								<Table.Head class="bg-card sticky top-0">Activity</Table.Head>
								<Table.Head class="bg-card sticky top-0">Last Outbound</Table.Head>
								<Table.Head class="bg-card sticky top-0">Last Inbound</Table.Head>
								<Table.Head class="bg-card sticky top-0">Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#if prospectContactsLoading}
								<Table.Row>
									<Table.Cell colspan={7} class="text-muted-foreground">
										Loading contacts…
									</Table.Cell>
								</Table.Row>
							{:else if selectedContacts.length === 0}
								<Table.Row>
									<Table.Cell colspan={7} class="text-muted-foreground">
										Select a prospect list to preview contacts.
									</Table.Cell>
								</Table.Row>
							{:else}
								{#each selectedContacts as contact (contact.externalContactId)}
									<Table.Row>
										<Table.Cell>
											<div class="font-semibold">{contact.name}</div>
										</Table.Cell>
										<Table.Cell>{contact.company}</Table.Cell>
										<Table.Cell>{contact.title}</Table.Cell>
										<Table.Cell>{formatActivity(contact.activity)}</Table.Cell>
										<Table.Cell title={contact.lastOutboundType ?? undefined}>
											{formatTimeAgo(contact.lastOutboundAt)}
										</Table.Cell>
										<Table.Cell title={contact.lastInboundType ?? undefined}>
											{formatTimeAgo(contact.lastInboundAt)}
										</Table.Cell>
										<Table.Cell>{formatStatus(contact.status)}</Table.Cell>
									</Table.Row>
								{/each}
							{/if}
						</Table.Body>
					</Table.Root>
				</div>
			</div>
		</Card.Content>

		<Card.Footer>
			<Button type="submit" disabled={store.busy}>Create session</Button>
		</Card.Footer>
	</Card.Root>
</form>
