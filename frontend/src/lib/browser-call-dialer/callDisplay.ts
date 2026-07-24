import type { CallStatus } from "./types";

export function getStatusColor(status: CallStatus["status"]): string {
	switch (status) {
		case "connected":
			return "#10b981";
		case "ringing":
		case "answered":
			return "#f59e0b";
		case "completed":
			return "#6b7280";
		case "failed":
		case "busy":
		case "no-answer":
			return "#ef4444";
		default:
			return "#6366f1";
	}
}

export function getStatusIcon(status: CallStatus["status"]): string {
	switch (status) {
		case "connected":
			return "✅";
		case "ringing":
			return "📞";
		case "answered":
			return "📱";
		case "completed":
			return "✓";
		case "failed":
		case "busy":
		case "no-answer":
			return "✕";
		default:
			return "⏳";
	}
}

export function formatDuration(seconds: number | undefined): string {
	if (!seconds) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function getCardPosition(index: number): {
	top: string;
	left: string;
	right: string;
	bottom: string;
} {
	const positions = [
		{ top: "20px", right: "20px", left: "auto", bottom: "auto" },
		{ top: "20px", left: "20px", right: "auto", bottom: "auto" },
		{ bottom: "20px", right: "20px", left: "auto", top: "auto" },
		{ bottom: "20px", left: "20px", right: "auto", top: "auto" },
	];
	return positions[index % 4]!;
}

export const TERMINAL_CALL_STATUSES = new Set<CallStatus["status"]>([
	"completed",
	"failed",
	"no-answer",
	"busy",
	"canceled",
]);

export const LIVE_CALL_STATUSES = new Set<CallStatus["status"]>([
	"initiated",
	"ringing",
	"answered",
	"connected",
]);

export function statusLabel(call: CallStatus, isActive: boolean): string {
	switch (call.status) {
		case "initiated":
			return "Connecting…";
		case "ringing":
			return "Ringing…";
		case "answered":
			return "Answering…";
		case "connected":
			if (call.answeredBy === "human") {
				return isActive ? "LIVE · Person (you’re on this call)" : "LIVE · Person";
			}
			return isActive ? "ACTIVE" : "On Hold";
		case "completed":
			return "Call ended";
		case "failed":
			return "Call failed";
		case "no-answer":
			return "No answer";
		case "canceled":
			return "Canceled";
		case "busy":
			return "Line busy";
		default:
			return call.status;
	}
}
