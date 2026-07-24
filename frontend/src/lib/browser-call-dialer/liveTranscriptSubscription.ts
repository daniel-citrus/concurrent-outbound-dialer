export type TranscriptTrack = "prospect" | "agent" | "unknown";

export type TranscriptLine = {
	track: TranscriptTrack;
	text: string;
	seq: number;
	timestamp: string;
	isFinal: boolean;
};

export type LiveTranscriptHandlers = {
	onLines: (callSid: string, lines: TranscriptLine[]) => void;
	onStopped?: (callSid: string) => void;
};

/** Minimal broadcast client shape (Supabase Realtime or equivalent). */
export type LiveTranscriptBroadcastClient = {
	channel(name: string): {
		on(
			event: "broadcast",
			filter: { event: string },
			callback: (msg: { payload?: Record<string, unknown> }) => void,
		): unknown;
		subscribe(): unknown;
	};
	removeChannel(channel: unknown): void;
};

let broadcastClient: LiveTranscriptBroadcastClient | null = null;
const channels = new Map<string, unknown>();
const lineBuffers = new Map<string, TranscriptLine[]>();

export function configureLiveTranscriptClient(client: LiveTranscriptBroadcastClient | null): void {
	broadcastClient = client;
}

function upsertLine(lines: TranscriptLine[], next: TranscriptLine): TranscriptLine[] {
	const updated = [...lines];
	for (let i = updated.length - 1; i >= 0; i--) {
		if (updated[i]!.track === next.track && !updated[i]!.isFinal) {
			updated[i] = next;
			return updated;
		}
	}
	updated.push(next);
	return updated;
}

export function subscribeToLiveTranscript(
	callSid: string,
	callLogId: string,
	handlers: LiveTranscriptHandlers,
): void {
	if (!broadcastClient || channels.has(callSid)) return;

	const channelName = `live-transcript:${callLogId}`;
	const channel = broadcastClient.channel(channelName);

	if (!lineBuffers.has(callSid)) {
		lineBuffers.set(callSid, []);
	}

	channel.on("broadcast", { event: "transcript" }, (msg) => {
		const payload = msg.payload;
		if (!payload) return;

		if (payload.type === "stopped") {
			handlers.onStopped?.(callSid);
			return;
		}

		if (payload.type !== "utterance") return;

		const next: TranscriptLine = {
			track: (payload.track as TranscriptTrack) || "unknown",
			text: String(payload.text ?? ""),
			seq: Number(payload.seq ?? 0),
			timestamp: String(payload.timestamp ?? ""),
			isFinal: Boolean(payload.isFinal),
		};

		const lines = upsertLine(lineBuffers.get(callSid) || [], next);
		lineBuffers.set(callSid, lines);
		handlers.onLines(callSid, lines);
	});

	channel.subscribe();
	channels.set(callSid, channel);
}

export function unsubscribeFromLiveTranscript(callSid: string): void {
	const channel = channels.get(callSid);
	if (channel && broadcastClient) {
		broadcastClient.removeChannel(channel);
		channels.delete(callSid);
	}
	lineBuffers.delete(callSid);
}

export function unsubscribeAllLiveTranscripts(): void {
	for (const callSid of [...channels.keys()]) {
		unsubscribeFromLiveTranscript(callSid);
	}
}

export function liveTranscriptSubscriptionSids(): IterableIterator<string> {
	return channels.keys();
}
