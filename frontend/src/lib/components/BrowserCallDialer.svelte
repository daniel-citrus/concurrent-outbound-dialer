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
</script>

{#if calls.length > 0}
	<div class="call-dialer-container" class:extension-mode={extensionMode}>
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
			{@const transcriptLines = liveTranscripts.get(call.callSid) || []}
			<div
				class="call-card"
				class:ringing={call.status === "ringing" || call.status === "answered"}
				class:connected={call.status === "connected"}
				class:ended={TERMINAL_CALL_STATUSES.has(call.status)}
				class:active-call={isActive && call.status === "connected"}
				class:waiting-call={!isActive && call.status === "connected"}
				class:human-live={isHumanLive}
				role="button"
				tabindex="0"
				onclick={(e) => onCardClick(e, call)}
				onkeydown={(e) => onCardKeydown(e, call)}
				style="
					top: {position.top};
					right: {position.right};
					left: {position.left};
					bottom: {position.bottom};
					border-left-color: {isHumanLive
					? '#34d399'
					: isActive && call.status === 'connected'
						? '#10b981'
						: statusColor};
				"
			>
				{#if isHumanLive}
					<div class="human-live-banner" aria-live="polite">
						<span class="human-live-emoji" aria-hidden="true">👤</span>
						<span class="human-live-banner-text">Live person on this call</span>
					</div>
				{/if}

				<div class="call-card-header">
					<div
						class="call-status-indicator"
						style="background-color: {statusColor}20; border-color: {statusColor};"
					>
						<span class="status-icon">{getStatusIcon(call.status)}</span>
					</div>
					<div class="call-contact-info">
						<div class="call-contact-name">{call.contact.name}</div>
						<div class="call-contact-details">
							<span>{call.contact.company}</span>
							{#if call.contact.phone}
								<span>•</span>
								<span>{call.contact.phone}</span>
							{/if}
						</div>
						<div class="amd-badge-row">
							<span
								class="amd-badge"
								class:amd-human={amdLive.variant === "human"}
								class:amd-machine={amdLive.variant === "machine"}
								class:amd-fax={amdLive.variant === "fax"}
								class:amd-unknown={amdLive.variant === "unknown"}
								class:amd-pending={amdLive.variant === "pending"}
								class:amd-greeting={amdLive.variant === "greeting"}
							>
								{#if amdLive.variant === "human"}
									<span class="amd-human-emoji" aria-hidden="true">👤</span>
								{/if}
								{amdLive.headline}
							</span>
							{#if amdLive.subline}
								<span class="amd-hint">{amdLive.subline}</span>
							{/if}
						</div>
					</div>
					{#if !TERMINAL_CALL_STATUSES.has(call.status)}
						<button
							class="call-card-close"
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

				<div class="call-card-body">
					<div class="call-status-text">{statusLabel(call, isActive)}</div>

					{#if call.status === "connected"}
						{@const level = getAudioLevel(call.callSid)}
						{@const bars = getEqualizerBars(level)}
						<div
							class="audio-visualizer"
							class:active={isActive && !mutedCalls.has(call.callSid)}
							class:muted={!isActive || mutedCalls.has(call.callSid)}
						>
							{#each bars as barHeight, i}
								<div
									class="eq-bar"
									class:speaking={level > 10}
									style="height: {Math.max(4, barHeight * 0.4)}px; animation-delay: {i * 0.1}s;"
								></div>
							{/each}
							<span class="audio-label">
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

					{#if call.status === "connected" && call.duration !== undefined}
						<div class="call-duration">Duration: {formatDuration(call.duration)}</div>
					{/if}
				</div>

				{#if transcriptLines.length > 0}
					<div class="live-transcript-strip" use:bindTranscriptRef={call.callSid}>
						<div class="live-transcript-fade-top"></div>
						{#each transcriptLines.slice(-8) as line, i (
							line.isFinal ? `f-${line.seq}-${line.track}` : `p-${i}-${line.track}`
						)}
							<div class="live-transcript-line" class:is-partial={!line.isFinal}>
								<span
									class="live-transcript-speaker"
									class:speaker-prospect={line.track === "prospect"}
									class:speaker-agent={line.track === "agent"}
								>
									{line.track === "prospect"
										? "Prospect"
										: line.track === "agent"
											? "Agent"
											: "???"}
								</span>
								<span class="live-transcript-text">{line.text}</span>
							</div>
						{/each}
					</div>
				{/if}

				{#if LIVE_CALL_STATUSES.has(call.status)}
					<div
						class="call-card-actions"
						role="group"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
					>
						<div class="call-actions-row">
							{#if isActive && call.status === "connected"}
								<button
									type="button"
									class="mute-toggle-btn"
									class:muted={mutedCalls.has(call.callSid)}
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
									class="keypad-toggle-btn"
									class:expanded={keypadExpandedCallSid === call.callSid}
									title="Keypad for IVR / tree menus"
									onclick={() => toggleKeypad(call.callSid)}
								>
									{keypadExpandedCallSid === call.callSid ? "Hide" : "Keypad"}
								</button>
							{/if}
							<button
								type="button"
								class="end-call-btn"
								onclick={() =>
									call.status === "connected"
										? endCall(call.callSid)
										: cancelCall(call.callSid)}
							>
								{call.status === "connected" ? "End Call" : "Cancel"}
							</button>
						</div>
					</div>
				{:else if TERMINAL_CALL_STATUSES.has(call.status)}
					<div
						class="call-card-actions"
						role="group"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							class="end-call-btn dismiss-btn"
							onclick={() => dismissCall(call.callSid)}
						>
							Dismiss
						</button>
					</div>
				{/if}

				{#if keypadExpandedCallSid === call.callSid && isActive}
					<div
						class="keypad"
						role="group"
						aria-label="DTMF keypad"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
					>
						{#each [0, 1, 2, 3] as row}
							<div class="keypad-row">
								{#each KEYPAD_KEYS.slice(row * 3, row * 3 + 3) as key}
									<button type="button" onclick={() => sendDtmf(key.digit)}>
										<span class="keypad-num">{key.digit}</span>
										{#if key.letters}
											<span class="keypad-letters">{key.letters}</span>
										{/if}
									</button>
								{/each}
							</div>
						{/each}
						{#if keypadDigits}
							<div class="keypad-status">Sent: {keypadDigits}</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.call-dialer-container {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
		z-index: 10000;
	}

	.call-card {
		position: fixed;
		width: 320px;
		background: linear-gradient(145deg, #1a1a1a, #2d2d2d);
		border: 1px solid #444;
		border-left: 4px solid #6366f1;
		border-radius: 12px;
		padding: 16px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		pointer-events: all;
		cursor: pointer;
		animation: slideIn 0.3s ease-out;
		z-index: 10001;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-20px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.call-card.ringing {
		animation: pulse 2s infinite;
		border-left-color: #f59e0b;
	}

	.call-card.connected {
		border-left-color: #10b981;
	}

	.call-card.active-call {
		border-left-color: #10b981;
		box-shadow:
			0 10px 30px rgba(16, 185, 129, 0.3),
			0 0 0 2px rgba(16, 185, 129, 0.5);
	}

	.call-card.waiting-call {
		border-left-color: #f59e0b;
		opacity: 0.85;
	}

	.call-card.human-live {
		border-color: rgba(52, 211, 153, 0.5);
		box-shadow:
			0 12px 40px rgba(52, 211, 153, 0.32),
			0 0 0 2px rgba(52, 211, 153, 0.45);
	}

	.call-card.human-live.waiting-call {
		opacity: 1;
		border-left-color: #34d399;
	}

	.human-live-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: -16px -16px 12px -16px;
		padding: 11px 14px;
		background: linear-gradient(90deg, rgba(16, 185, 129, 0.42), rgba(52, 211, 153, 0.2));
		border-bottom: 1px solid rgba(52, 211, 153, 0.5);
		border-radius: 11px 11px 0 0;
	}

	.human-live-emoji {
		font-size: 22px;
		line-height: 1;
	}

	.human-live-banner-text {
		font-size: 13px;
		font-weight: 700;
		color: #ecfdf5;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.amd-human-emoji {
		margin-right: 6px;
		font-size: 13px;
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		}
		50% {
			box-shadow: 0 10px 30px rgba(245, 158, 11, 0.4);
		}
	}

	.call-card-header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 12px;
	}

	.call-status-indicator {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid;
		flex-shrink: 0;
	}

	.status-icon {
		font-size: 18px;
	}

	.call-contact-info {
		flex: 1;
		min-width: 0;
	}

	.call-contact-name {
		font-weight: 600;
		font-size: 16px;
		color: #fff;
		margin-bottom: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.call-contact-details {
		font-size: 12px;
		color: #999;
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.amd-badge-row {
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: flex-start;
	}

	.amd-badge {
		display: inline-block;
		font-size: 11px;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid #444;
		color: #e5e5e5;
		background: rgba(255, 255, 255, 0.06);
		max-width: 100%;
	}

	.amd-badge.amd-human {
		border-color: rgba(52, 211, 153, 0.75);
		background: rgba(16, 185, 129, 0.28);
		color: #d1fae5;
	}

	.amd-badge.amd-machine {
		border-color: rgba(245, 158, 11, 0.55);
		background: rgba(245, 158, 11, 0.12);
		color: #fcd34d;
	}

	.amd-badge.amd-fax {
		border-color: rgba(239, 68, 68, 0.5);
		background: rgba(239, 68, 68, 0.12);
		color: #fca5a5;
	}

	.amd-badge.amd-unknown {
		border-color: rgba(148, 163, 184, 0.5);
		color: #cbd5e1;
	}

	.amd-badge.amd-pending {
		border-color: rgba(99, 102, 241, 0.45);
		background: rgba(99, 102, 241, 0.1);
		color: #a5b4fc;
	}

	.amd-badge.amd-greeting {
		border-color: rgba(168, 85, 247, 0.5);
		background: rgba(168, 85, 247, 0.12);
		color: #e9d5ff;
	}

	.amd-hint {
		font-size: 10px;
		line-height: 1.35;
		color: #888;
	}

	.call-card-close {
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid #444;
		border-radius: 4px;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: #ccc;
		font-size: 14px;
		flex-shrink: 0;
	}

	.call-card-close:hover {
		background: rgba(239, 68, 68, 0.2);
		border-color: #ef4444;
		color: #ef4444;
	}

	.call-card-body {
		margin-bottom: 12px;
	}

	.call-status-text {
		font-size: 14px;
		color: #ccc;
		margin-bottom: 8px;
		font-weight: 500;
	}

	.call-duration {
		font-size: 12px;
		color: #888;
		font-family: monospace;
	}

	.call-card-actions {
		display: flex;
		gap: 8px;
	}

	.call-actions-row {
		display: flex;
		gap: 8px;
		align-items: center;
		width: 100%;
	}

	.mute-toggle-btn,
	.keypad-toggle-btn {
		background: rgba(100, 116, 139, 0.2);
		border: 1px solid #64748b;
		border-radius: 6px;
		padding: 8px 12px;
		color: #94a3b8;
		font-weight: 600;
		cursor: pointer;
		font-size: 14px;
	}

	.mute-toggle-btn.muted {
		background: rgba(245, 158, 11, 0.2);
		border-color: #f59e0b;
		color: #fbbf24;
	}

	.keypad-toggle-btn.expanded {
		background: rgba(100, 116, 139, 0.35);
		border-color: #94a3b8;
		color: #e2e8f0;
	}

	.end-call-btn {
		flex: 1;
		background: rgba(239, 68, 68, 0.2);
		border: 1px solid #ef4444;
		border-radius: 6px;
		padding: 8px 16px;
		color: #ef4444;
		font-weight: 600;
		cursor: pointer;
		font-size: 14px;
	}

	.end-call-btn.dismiss-btn {
		background: rgba(100, 100, 100, 0.2);
		border-color: #666;
		color: #999;
	}

	.audio-visualizer {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 32px;
		padding: 6px 10px;
		background: rgba(0, 0, 0, 0.3);
		border-radius: 6px;
		margin: 8px 0;
	}

	.audio-visualizer.active {
		background: rgba(16, 185, 129, 0.15);
		border: 1px solid rgba(16, 185, 129, 0.3);
	}

	.audio-visualizer.muted {
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.2);
	}

	.eq-bar {
		width: 4px;
		min-height: 4px;
		border-radius: 2px;
		background: linear-gradient(to top, #10b981, #34d399);
		transition: height 0.1s ease-out;
	}

	.audio-visualizer.muted .eq-bar {
		background: linear-gradient(to top, #f59e0b, #fbbf24);
		opacity: 0.5;
	}

	.audio-label {
		font-size: 11px;
		color: #10b981;
		margin-left: 8px;
		font-weight: 500;
		text-transform: uppercase;
	}

	.audio-visualizer.muted .audio-label {
		color: #f59e0b;
	}

	.keypad {
		margin-top: 12px;
		display: grid;
		gap: 6px;
	}

	.keypad-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}

	.keypad button {
		background: #1f2937;
		color: #fff;
		border: 1px solid #374151;
		border-radius: 8px;
		padding: 6px 0;
		font-weight: 600;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.keypad-num {
		font-size: 16px;
		line-height: 1;
	}

	.keypad-letters {
		font-size: 8px;
		color: #9ca3af;
	}

	.keypad-status {
		font-size: 12px;
		color: #9ca3af;
	}

	.live-transcript-strip {
		position: relative;
		max-height: 120px;
		overflow-y: auto;
		background: rgba(0, 0, 0, 0.4);
		border-radius: 6px;
		padding: 8px 10px;
		margin-bottom: 10px;
		font-family: ui-monospace, monospace;
		font-size: 11px;
		line-height: 1.5;
	}

	.live-transcript-fade-top {
		position: sticky;
		top: 0;
		height: 12px;
		margin: -8px -10px 0 -10px;
		background: linear-gradient(to bottom, rgba(0, 0, 0, 0.4), transparent);
		pointer-events: none;
	}

	.live-transcript-line.is-partial {
		opacity: 0.55;
		font-style: italic;
	}

	.live-transcript-speaker {
		font-weight: 700;
		font-size: 10px;
		text-transform: uppercase;
		margin-right: 6px;
	}

	.live-transcript-speaker.speaker-prospect {
		color: #93c5fd;
	}

	.live-transcript-speaker.speaker-agent {
		color: #86efac;
	}

	.live-transcript-text {
		color: #d4d4d4;
	}

	.call-dialer-container.extension-mode {
		padding: 8px;
		pointer-events: all;
		overflow-y: auto;
		max-height: 100vh;
	}

	.call-dialer-container.extension-mode .call-card {
		position: relative;
		top: auto;
		right: auto;
		left: auto;
		bottom: auto;
		width: 100%;
	}

	@media (max-width: 768px) {
		.call-dialer-container {
			top: auto;
			bottom: 0;
			max-height: 70vh;
			overflow-y: auto;
			display: flex;
			flex-direction: column;
			gap: 8px;
			padding: 8px;
			pointer-events: all;
			background: rgba(0, 0, 0, 0.5);
		}

		.call-card {
			position: relative !important;
			top: auto !important;
			bottom: auto !important;
			left: auto !important;
			right: auto !important;
			width: 100%;
		}
	}
</style>
