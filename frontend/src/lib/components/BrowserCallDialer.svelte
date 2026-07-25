<script lang="ts">
	import { createEventDispatcher, onDestroy, tick } from "svelte";
	import { amdLiveDisplay, amdSortPriority } from "$lib/browser-call-dialer/amdUi";
	import {
		formatDuration,
		getCardPosition,
		getStatusColor,
		getStatusIcon,
		LIVE_CALL_STATUSES,
		statusLabel,
		TERMINAL_CALL_STATUSES,
	} from "$lib/browser-call-dialer/callDisplay";
	import {
		liveTranscriptSubscriptionSids,
		subscribeToLiveTranscript,
		unsubscribeAllLiveTranscripts,
		unsubscribeFromLiveTranscript,
		type TranscriptLine,
	} from "$lib/browser-call-dialer/liveTranscriptSubscription";
	import type { CallStatus } from "$lib/browser-call-dialer/types";
	import type { VisualizerStore } from "$lib/store.svelte";
	import type { CallAttempt, CallAttemptStatus } from "$lib/types";
	import { isActiveCall as isActiveAttemptStatus } from "$lib/types";
	import { cn } from "$lib/utils";

	let {
		store,
		activeCallSid = null,
		onSwitchCall = null,
		audioLevels = new Map<string, number>(),
		extensionMode = false,
	}: {
		store: VisualizerStore;
		activeCallSid?: string | null;
		onSwitchCall?: ((callSid: string) => void) | null;
		audioLevels?: Map<string, number>;
		extensionMode?: boolean;
	} = $props();

	const dispatch = createEventDispatcher<{
		endCall: { callSid: string };
		cancelCall: { callSid: string };
		openContact: { contactKey: string; callSid: string };
	}>();

	const ATTEMPT_TERMINAL: CallAttemptStatus[] = [
		"completed",
		"busy",
		"failed",
		"no_answer",
		"canceled",
	];

	let durationTick = $state(0);

	$effect(() => {
		const id = setInterval(() => {
			durationTick++;
		}, 1000);
		return () => clearInterval(id);
	});

	function mapStatus(status: CallAttemptStatus): CallStatus["status"] {
		switch (status) {
			case "creating":
			case "queued":
			case "initiated":
				return "initiated";
			case "ringing":
				return "ringing";
			case "in_progress":
				return "connected";
			case "completed":
				return "completed";
			case "busy":
				return "busy";
			case "failed":
			case "unknown":
				return "failed";
			case "no_answer":
				return "no-answer";
			case "canceled":
				return "canceled";
			default:
				return "initiated";
		}
	}

	function callSidFor(call: CallAttempt): string {
		return call.providerCallId || call.id;
	}

	function callDurationSeconds(call: CallAttempt): number | undefined {
		void durationTick;
		if (call.status !== "in_progress") return undefined;
		const startMs = call.answeredAt
			? new Date(call.answeredAt).getTime()
			: new Date(call.createdAt).getTime();
		return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
	}

	function toCallStatus(call: CallAttempt): CallStatus {
		const detail = store.getContactDetailByContactId(call.contactId);
		const contact = store.contacts.find((c) => c.id === call.contactId);

		return {
			callSid: callSidFor(call),
			status: mapStatus(call.status),
			startTime: new Date(call.createdAt).getTime(),
			duration: callDurationSeconds(call),
			contact: {
				name:
					(detail.name || "").trim() ||
					(contact?.externalContactId || "").trim() ||
					"Unknown contact",
				company: (detail.company || "").trim(),
				phone: (contact?.phoneNumber || detail.phoneNumber || "").trim(),
				email: "",
				contact_key: contact?.externalContactId,
			},
			answeredBy: call.status === "in_progress" ? "human" : null,
			pstnJoined: call.status === "in_progress",
			amdMode: null,
		};
	}

	/** Current-round winner only — never fall back to other active or terminal calls. */
	const winnerAttempt = $derived.by(() => {
		void store.calls;
		const winnerId = store.session?.winningCallAttemptId;
		if (!winnerId || store.session?.status !== "winner_selected") return null;

		const winner =
			store.calls.find((call) => call.id === winnerId) ??
			(store.snapshot?.winningCall?.id === winnerId ? store.snapshot.winningCall : null);

		if (!winner || !isActiveAttemptStatus(winner.status)) return null;
		return winner;
	});

	const calls = $derived(winnerAttempt ? [toCallStatus(winnerAttempt)] : []);

	const resolvedActiveCallSid = $derived.by(() => {
		if (!winnerAttempt) return null;
		if (activeCallSid) return activeCallSid;
		return callSidFor(winnerAttempt);
	});

	function findCallAttempt(callSid: string): CallAttempt | undefined {
		return store.calls.find((c) => callSidFor(c) === callSid || c.id === callSid);
	}

	const KEYPAD_KEYS: Array<{ digit: string; letters?: string }> = [
		{ digit: "1" },
		{ digit: "2", letters: "ABC" },
		{ digit: "3", letters: "DEF" },
		{ digit: "4", letters: "GHI" },
		{ digit: "5", letters: "JKL" },
		{ digit: "6", letters: "MNO" },
		{ digit: "7", letters: "PQRS" },
		{ digit: "8", letters: "TUV" },
		{ digit: "9", letters: "WXYZ" },
		{ digit: "*" },
		{ digit: "0" },
		{ digit: "#" },
	];

	let liveTranscripts = $state(new Map<string, TranscriptLine[]>());
	let transcriptScrollElements = new Map<string, HTMLDivElement>();
	let mutedCalls = $state(new Set<string>());
	let keypadExpandedCallSid = $state<string | null>(null);
	let keypadCallSid = $state<string | null>(null);
	let keypadDigits = $state("");
	let keypadClearTimer: ReturnType<typeof setTimeout> | null = null;

	let internalAudioLevels = $state(new Map<string, number>());
	let audioContext: AudioContext | null = null;
	const callAnalysers = new Map<
		string,
		{ analyser: AnalyserNode; source: MediaStreamAudioSourceNode; clonedTracks?: MediaStreamTrack[] }
	>();
	let audioLevelAnimationId: number | null = null;
	const trackedCallSids = new Set<string>();
	let audioUpdateTick = $state(0);

	const sortedCallsArray = $derived(
		calls.length <= 1
			? calls
			: [...calls].sort(
					(a, b) => amdSortPriority(a.answeredBy) - amdSortPriority(b.answeredBy),
				),
	);

	$effect(() => {
		if (calls.length === 1) {
			const sid = calls[0]?.callSid;
			if (sid && sid !== keypadCallSid) keypadCallSid = sid;
		} else if (calls.length === 0) {
			keypadCallSid = null;
		}
	});

	$effect(() => {
		if (keypadExpandedCallSid && !calls.some((c) => c.callSid === keypadExpandedCallSid)) {
			keypadExpandedCallSid = null;
		}
	});

	$effect(() => {
		for (const call of calls) {
			const logId = call.callLogId;
			if (logId && !TERMINAL_CALL_STATUSES.has(call.status)) {
				subscribeToLiveTranscript(call.callSid, logId, {
					onLines: (sid, lines) => {
						liveTranscripts.set(sid, lines);
						liveTranscripts = new Map(liveTranscripts);
						void tick().then(() => {
							const el = transcriptScrollElements.get(sid);
							if (el) el.scrollTop = el.scrollHeight;
						});
					},
				});
			}
		}

		for (const sid of [...liveTranscriptSubscriptionSids()]) {
			if (!calls.some((c) => c.callSid === sid)) {
				unsubscribeFromLiveTranscript(sid);
				liveTranscripts.delete(sid);
				liveTranscripts = new Map(liveTranscripts);
			}
		}
	});

	$effect(() => {
		for (const call of calls) {
			if (call.status === "connected" && !trackedCallSids.has(call.callSid)) {
				trackedCallSids.add(call.callSid);
				const connection = call.connection || call.device;
				if (connection) setupAudioAnalyser(call.callSid, connection);
			}
		}

		for (const sid of [...trackedCallSids]) {
			if (!calls.some((c) => c.callSid === sid)) cleanupAudioAnalyser(sid);
		}
	});

	onDestroy(() => {
		if (keypadClearTimer) clearTimeout(keypadClearTimer);
		if (audioLevelAnimationId) {
			cancelAnimationFrame(audioLevelAnimationId);
			audioLevelAnimationId = null;
		}
		for (const sid of [...callAnalysers.keys()]) cleanupAudioAnalyser(sid);
		trackedCallSids.clear();
		internalAudioLevels.clear();
		if (audioContext && audioContext.state !== "closed") {
			void audioContext.close();
			audioContext = null;
		}
		unsubscribeAllLiveTranscripts();
		liveTranscripts.clear();
		transcriptScrollElements.clear();
	});

	function isFocusedCall(callSid: string): boolean {
		if (!resolvedActiveCallSid && calls.length === 1) return true;
		return resolvedActiveCallSid === callSid;
	}

	function getCallBySid(sid: string): CallStatus | undefined {
		return calls.find((c) => c.callSid === sid);
	}

	function openContact(call: CallStatus) {
		const contactKey = call.contact?.contact_key;
		if (contactKey) dispatch("openContact", { contactKey, callSid: call.callSid });
	}

	function onCardClick(e: MouseEvent, call: CallStatus) {
		const target = e.target as HTMLElement | null;
		if (target?.closest?.("button, a, input, textarea, select, .call-card-actions, .keypad")) return;
		openContact(call);
	}

	function onCardKeydown(e: KeyboardEvent, call: CallStatus) {
		if (e.target !== e.currentTarget) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			openContact(call);
		}
	}

	function muteTarget(call: CallStatus | undefined) {
		return call?.device || call?.connection;
	}

	function muteCallDevice(callSid: string, mute: boolean) {
		const target = muteTarget(getCallBySid(callSid));
		if (!target?.mute) return;
		try {
			target.mute(mute);
		} catch {
			/* optional in mock visualizer */
		}
	}

	function toggleMute(callSid: string) {
		const isMuted = mutedCalls.has(callSid);
		if (isMuted) {
			mutedCalls.delete(callSid);
			muteCallDevice(callSid, false);
		} else {
			mutedCalls.add(callSid);
			muteCallDevice(callSid, true);
		}
		mutedCalls = new Set(mutedCalls);
	}

	function toggleKeypad(callSid: string) {
		keypadExpandedCallSid = keypadExpandedCallSid === callSid ? null : callSid;
		keypadCallSid = callSid;
	}

	function sendDtmf(digit: string) {
		if (!keypadCallSid) return;
		const call = getCallBySid(keypadCallSid);
		const connection = call?.connection || call?.device;
		if (!connection?.sendDigits) return;
		try {
			connection.sendDigits(digit);
			keypadDigits += digit;
			if (keypadClearTimer) clearTimeout(keypadClearTimer);
			keypadClearTimer = setTimeout(() => {
				keypadDigits = "";
			}, 4000);
		} catch {
			/* optional in mock visualizer */
		}
	}

	function disconnectLocal(call: CallStatus | undefined) {
		if (!call) return;
		for (const target of [call.device, call.connection]) {
			if (!target?.disconnect) continue;
			try {
				target.disconnect();
			} catch {
				/* already disconnected */
			}
		}
	}

	function cancelCall(callSid: string) {
		disconnectLocal(getCallBySid(callSid));
		const attempt = findCallAttempt(callSid);
		if (attempt && !ATTEMPT_TERMINAL.includes(attempt.status)) {
			void store.simulate(attempt.id, "canceled");
		}
		dispatch("cancelCall", { callSid });
	}

	function endCall(callSid: string) {
		disconnectLocal(getCallBySid(callSid));
		const attempt = findCallAttempt(callSid);
		if (attempt && !ATTEMPT_TERMINAL.includes(attempt.status)) {
			void store.simulate(attempt.id, "completed");
		}
		dispatch("endCall", { callSid });
	}

	function dismissCall(callSid: string) {
		dispatch("endCall", { callSid });
	}

	function bindTranscriptRef(node: HTMLDivElement, callSid: string) {
		transcriptScrollElements.set(callSid, node);
		node.scrollTop = node.scrollHeight;
		return {
			destroy() {
				transcriptScrollElements.delete(callSid);
			},
		};
	}

	function ensureAudioContext(): AudioContext {
		if (!audioContext || audioContext.state === "closed") {
			audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		}
		if (audioContext.state === "suspended") void audioContext.resume();
		return audioContext;
	}

	function setupAudioAnalyser(callSid: string, connection: any): void {
		if (!connection || callAnalysers.has(callSid)) return;
		try {
			const remoteStream = connection.getRemoteStream?.();
			if (!remoteStream) return;

			const ctx = ensureAudioContext();
			const visualizationStream = new MediaStream();
			remoteStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
				visualizationStream.addTrack(track.clone());
			});

			const source = ctx.createMediaStreamSource(visualizationStream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.5;
			source.connect(analyser);

			callAnalysers.set(callSid, {
				analyser,
				source,
				clonedTracks: visualizationStream.getAudioTracks(),
			});

			if (!audioLevelAnimationId) startAudioLevelAnimation();
		} catch {
			/* visualizer is optional */
		}
	}

	function cleanupAudioAnalyser(callSid: string): void {
		const data = callAnalysers.get(callSid);
		if (data) {
			try {
				data.source.disconnect();
			} catch {
				/* ignore */
			}
			data.clonedTracks?.forEach((t) => t.stop());
			callAnalysers.delete(callSid);
		}
		internalAudioLevels.delete(callSid);
		trackedCallSids.delete(callSid);

		if (callAnalysers.size === 0 && audioLevelAnimationId) {
			cancelAnimationFrame(audioLevelAnimationId);
			audioLevelAnimationId = null;
		}
	}

	function startAudioLevelAnimation(): void {
		const updateLevels = () => {
			let hasChanges = false;
			callAnalysers.forEach(({ analyser }, callSid) => {
				const dataArray = new Uint8Array(analyser.frequencyBinCount);
				analyser.getByteFrequencyData(dataArray);
				let sum = 0;
				for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]! * dataArray[i]!;
				const rms = Math.sqrt(sum / dataArray.length);
				const level = Math.min(100, Math.round((rms / 128) * 100 * 1.5));
				const prev = internalAudioLevels.get(callSid) || 0;
				if (Math.abs(level - prev) > 2) {
					internalAudioLevels.set(callSid, level);
					hasChanges = true;
				}
			});
			if (hasChanges) {
				internalAudioLevels = new Map(internalAudioLevels);
				audioUpdateTick++;
			}
			if (callAnalysers.size > 0) {
				audioLevelAnimationId = requestAnimationFrame(updateLevels);
			}
		};
		audioLevelAnimationId = requestAnimationFrame(updateLevels);
	}

	function getAudioLevel(callSid: string): number {
		void audioUpdateTick;
		const external = audioLevels.get(callSid);
		if (external !== undefined && external > 0) return external;
		return internalAudioLevels.get(callSid) || 0;
	}

	function getEqualizerBars(level: number): number[] {
		const base = level / 100;
		const bars: number[] = [];
		for (let i = 0; i < 5; i++) {
			const variation = Math.sin(Date.now() / 100 + i * 0.5) * 0.2;
			bars.push(Math.max(0.1, Math.min(1, base + variation * base)) * 100);
		}
		return bars;
	}

	// Parent may pass onSwitchCall for audio focus without exposing it in the UI.
	$effect(() => {
		void onSwitchCall;
	});

	const amdBadgeClass: Record<string, string> = {
		human: "border-emerald-400/75 bg-emerald-500/30 text-emerald-100",
		machine: "border-amber-500/55 bg-amber-500/15 text-amber-300",
		fax: "border-red-500/50 bg-red-500/15 text-red-300",
		unknown: "border-slate-400/50 text-slate-300",
		pending: "border-indigo-500/45 bg-indigo-500/10 text-indigo-300",
		greeting: "border-purple-500/50 bg-purple-500/15 text-purple-200",
	};
</script>

{#if calls.length > 0}
	<div
		class={cn(
			"pointer-events-none fixed inset-0 z-[10000]",
			extensionMode && "pointer-events-auto max-h-screen overflow-y-auto p-2",
			"max-md:pointer-events-auto max-md:top-auto max-md:bottom-0 max-md:flex max-md:max-h-[70vh] max-md:flex-col max-md:gap-2 max-md:overflow-y-auto max-md:bg-black/50 max-md:p-2",
		)}
	>
		{#each sortedCallsArray as call, index (call.callSid)}
			{@const position = getCardPosition(index)}
			{@const statusColor = getStatusColor(call.status)}
			{@const isActive = isFocusedCall(call.callSid)}
			{@const amdLive = amdLiveDisplay({
				answeredBy: call.answeredBy,
				legStatus: call.status,
				amdMode: call.amdMode ?? null,
				pstnJoined: call.pstnJoined ?? false,
				pstnJoinedAt: call.pstnJoinedAt ?? null,
			})}
			{@const isHumanLive = call.answeredBy === "human" && !TERMINAL_CALL_STATUSES.has(call.status)}
			{@const isRinging = call.status === "ringing" || call.status === "answered"}
			{@const isConnected = call.status === "connected"}
			{@const isWaiting = !isActive && isConnected}
			{@const transcriptLines = liveTranscripts.get(call.callSid) || []}
			<div
				class={cn(
					"animate-dialer-slide-in pointer-events-auto fixed z-[10001] w-80 cursor-pointer rounded-xl border border-[#444] border-l-4 bg-gradient-to-br from-[#1a1a1a] to-[#2d2d2d] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.5)]",
					extensionMode &&
						"relative top-auto right-auto bottom-auto left-auto w-full",
					"max-md:relative max-md:top-auto! max-md:right-auto! max-md:bottom-auto! max-md:left-auto! max-md:w-full",
					isRinging && "animate-dialer-ring-pulse",
					isActive &&
						isConnected &&
						"shadow-[0_10px_30px_rgba(16,185,129,0.3),0_0_0_2px_rgba(16,185,129,0.5)]",
					isWaiting && !isHumanLive && "opacity-85",
					isHumanLive &&
						"border-emerald-400/50 shadow-[0_12px_40px_rgba(52,211,153,0.32),0_0_0_2px_rgba(52,211,153,0.45)]",
					isHumanLive && isWaiting && "opacity-100",
				)}
				role="button"
				tabindex="0"
				onclick={(e) => onCardClick(e, call)}
				onkeydown={(e) => onCardKeydown(e, call)}
				style="
					top: {extensionMode ? 'auto' : position.top};
					right: {extensionMode ? 'auto' : position.right};
					left: {extensionMode ? 'auto' : position.left};
					bottom: {extensionMode ? 'auto' : position.bottom};
					border-left-color: {isHumanLive
					? '#34d399'
					: isActive && isConnected
						? '#10b981'
						: statusColor};
				"
			>
				{#if isHumanLive}
					<div
						class="-mx-4 -mt-4 mb-3 flex items-center gap-2.5 rounded-t-[11px] border-b border-emerald-400/50 bg-gradient-to-r from-emerald-500/40 to-emerald-400/20 px-3.5 py-2.5"
						aria-live="polite"
					>
						<span class="text-[22px] leading-none" aria-hidden="true">👤</span>
						<span class="text-[13px] font-bold tracking-wide text-emerald-50 uppercase">
							Live person on this call
						</span>
					</div>
				{/if}

				<div class="mb-3 flex items-start gap-3">
					<div
						class="flex size-10 shrink-0 items-center justify-center rounded-full border-2"
						style="background-color: {statusColor}20; border-color: {statusColor};"
					>
						<span class="text-lg">{getStatusIcon(call.status)}</span>
					</div>
					<div class="min-w-0 flex-1">
						<div class="mb-1 truncate text-base font-semibold text-white">
							{call.contact.name}
						</div>
						<div class="flex flex-wrap gap-1.5 text-xs text-[#999]">
							<span>{call.contact.company}</span>
							{#if call.contact.phone}
								<span>•</span>
								<span>{call.contact.phone}</span>
							{/if}
						</div>
						<div class="mt-2 flex flex-col items-start gap-1">
							<span
								class={cn(
									"inline-block max-w-full rounded-md border border-[#444] bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-[#e5e5e5]",
									amdBadgeClass[amdLive.variant],
								)}
							>
								{#if amdLive.variant === "human"}
									<span class="mr-1.5 text-[13px]" aria-hidden="true">👤</span>
								{/if}
								{amdLive.headline}
							</span>
							{#if amdLive.subline}
								<span class="text-[10px] leading-snug text-[#888]">{amdLive.subline}</span>
							{/if}
						</div>
					</div>
					{#if !TERMINAL_CALL_STATUSES.has(call.status)}
						<button
							class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border border-[#444] bg-white/10 text-sm text-[#ccc] hover:border-red-500 hover:bg-red-500/20 hover:text-red-500"
							type="button"
							title="Cancel call"
							onclick={(e) => {
								e.stopPropagation();
								cancelCall(call.callSid);
							}}
						>
							✕
						</button>
					{/if}
				</div>

				<div class="mb-3">
					<div class="mb-2 text-sm font-medium text-[#ccc]">{statusLabel(call, isActive)}</div>

					{#if isConnected}
						{@const level = getAudioLevel(call.callSid)}
						{@const bars = getEqualizerBars(level)}
						{@const meterMuted = !isActive || mutedCalls.has(call.callSid)}
						<div
							class={cn(
								"my-2 flex h-8 items-end gap-0.5 rounded-md bg-black/30 px-2.5 py-1.5",
								!meterMuted && "border border-emerald-500/30 bg-emerald-500/15",
								meterMuted && "border border-amber-500/20 bg-amber-500/10",
							)}
						>
							{#each bars as barHeight, i}
								<div
									class={cn(
										"min-h-1 w-1 rounded-sm bg-gradient-to-t from-emerald-500 to-emerald-400 transition-[height] duration-100",
										meterMuted && "bg-gradient-to-t from-amber-500 to-amber-300 opacity-50",
									)}
									style="height: {Math.max(4, barHeight * 0.4)}px; animation-delay: {i * 0.1}s;"
								></div>
							{/each}
							<span
								class={cn(
									"ml-2 text-[11px] font-medium tracking-wide text-emerald-500 uppercase",
									meterMuted && "text-amber-500",
								)}
							>
								{#if mutedCalls.has(call.callSid)}
									Muted
								{:else if isActive}
									{level > 15 ? "Speaking" : "Listening"}
								{:else}
									Muted
								{/if}
							</span>
						</div>
					{/if}

					{#if isConnected && call.duration !== undefined}
						<div class="font-mono text-xs text-[#888]">
							Duration: {formatDuration(call.duration)}
						</div>
					{/if}
				</div>

				{#if transcriptLines.length > 0}
					<div
						class="relative mb-2.5 max-h-[120px] overflow-y-auto rounded-md bg-black/40 px-2.5 py-2 font-mono text-[11px] leading-normal"
						use:bindTranscriptRef={call.callSid}
					>
						<div
							class="pointer-events-none sticky top-0 -mx-2.5 -mt-2 h-3 bg-gradient-to-b from-black/40 to-transparent"
						></div>
						{#each transcriptLines.slice(-8) as line, i (
							line.isFinal ? `f-${line.seq}-${line.track}` : `p-${i}-${line.track}`
						)}
							<div class={cn("mb-0.5 last:mb-0", !line.isFinal && "italic opacity-55")}>
								<span
									class={cn(
										"mr-1.5 text-[10px] font-bold uppercase",
										line.track === "prospect" && "text-blue-300",
										line.track === "agent" && "text-green-300",
									)}
								>
									{line.track === "prospect"
										? "Prospect"
										: line.track === "agent"
											? "Agent"
											: "???"}
								</span>
								<span class="text-neutral-300">{line.text}</span>
							</div>
						{/each}
					</div>
				{/if}

				{#if LIVE_CALL_STATUSES.has(call.status)}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="flex gap-2"
						role="group"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
					>
						<div class="flex w-full items-center gap-2">
							{#if isActive && isConnected}
								<button
									type="button"
									class={cn(
										"cursor-pointer rounded-md border border-slate-500 bg-slate-500/20 px-3 py-2 text-sm font-semibold text-slate-400",
										mutedCalls.has(call.callSid) &&
											"border-amber-500 bg-amber-500/20 text-amber-400",
									)}
									title={mutedCalls.has(call.callSid)
										? "Unmute microphone"
										: "Mute microphone"}
									onclick={() => toggleMute(call.callSid)}
								>
									{mutedCalls.has(call.callSid) ? "Unmute" : "Mute"}
								</button>
							{/if}
							{#if isActive}
								<button
									type="button"
									class={cn(
										"cursor-pointer rounded-md border border-slate-500 bg-slate-500/20 px-3 py-2 text-sm font-semibold text-slate-400",
										keypadExpandedCallSid === call.callSid &&
											"border-slate-400 bg-slate-500/35 text-slate-200",
									)}
									title="Keypad for IVR / tree menus"
									onclick={() => toggleKeypad(call.callSid)}
								>
									{keypadExpandedCallSid === call.callSid ? "Hide" : "Keypad"}
								</button>
							{/if}
							<button
								type="button"
								class="flex-1 cursor-pointer rounded-md border border-red-500 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-500"
								onclick={() =>
									isConnected ? endCall(call.callSid) : cancelCall(call.callSid)}
							>
								{isConnected ? "End Call" : "Cancel"}
							</button>
						</div>
					</div>
				{:else if TERMINAL_CALL_STATUSES.has(call.status)}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="flex gap-2"
						role="group"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							class="flex-1 cursor-pointer rounded-md border border-[#666] bg-neutral-500/20 px-4 py-2 text-sm font-semibold text-[#999]"
							onclick={() => dismissCall(call.callSid)}
						>
							Dismiss
						</button>
					</div>
				{/if}

				{#if keypadExpandedCallSid === call.callSid && isActive}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="mt-3 grid gap-1.5"
						role="group"
						aria-label="DTMF keypad"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
					>
						{#each [0, 1, 2, 3] as row}
							<div class="grid grid-cols-3 gap-1.5">
								{#each KEYPAD_KEYS.slice(row * 3, row * 3 + 3) as key}
									<button
										type="button"
										class="flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-gray-700 bg-gray-800 py-1.5 font-semibold text-white hover:border-gray-600 hover:bg-gray-900"
										onclick={() => sendDtmf(key.digit)}
									>
										<span class="text-base leading-none">{key.digit}</span>
										{#if key.letters}
											<span class="text-[8px] text-gray-400">{key.letters}</span>
										{/if}
									</button>
								{/each}
							</div>
						{/each}
						{#if keypadDigits}
							<div class="text-xs text-gray-400">Sent: {keypadDigits}</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
