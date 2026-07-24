/**
 * Answering-machine vs human detection — UI labels and multi-call sort order.
 */

const MACHINE_END = new Set(["machine_end_beep", "machine_end_silence", "machine_end_other"]);

export type AmdBadgeVariant = "human" | "machine" | "fax" | "unknown" | "pending" | "greeting";

/** Lower = show first when multiple calls are active (prioritize humans). */
export function amdSortPriority(answeredBy: string | null | undefined): number {
	if (answeredBy === "human") return 0;
	if (!answeredBy) return 15;
	if (answeredBy === "unknown") return 25;
	if (answeredBy === "machine_start") return 40;
	if (MACHINE_END.has(answeredBy)) return 45;
	if (answeredBy === "fax") return 50;
	return 20;
}

export function amdBadgeVariant(answeredBy: string | null | undefined): AmdBadgeVariant {
	if (answeredBy === "human") return "human";
	if (answeredBy === "fax") return "fax";
	if (answeredBy === "unknown") return "unknown";
	if (!answeredBy) return "pending";
	if (answeredBy === "machine_start" || MACHINE_END.has(answeredBy)) return "machine";
	return "unknown";
}

export function amdTitle(answeredBy: string | null | undefined): string {
	if (!answeredBy) return "Detecting who answered…";
	switch (answeredBy) {
		case "human":
			return "Live person answered";
		case "machine_start":
			return "Voicemail (early)";
		case "machine_end_beep":
			return "Voicemail (after beep)";
		case "machine_end_silence":
			return "Voicemail (silence end)";
		case "machine_end_other":
			return "Voicemail…";
		case "fax":
			return "Fax / modem";
		case "unknown":
			return "Could not classify";
		default:
			return `Detection: ${answeredBy}`;
	}
}

export function amdSubtitle(answeredBy: string | null | undefined): string {
	if (!answeredBy) return "Analyzing who answered on this line…";
	if (answeredBy === "human") return "Real conversation — this leg is a person.";
	if (answeredBy === "machine_start" || MACHINE_END.has(answeredBy)) {
		return "Voicemail path detected on this line.";
	}
	if (answeredBy === "fax") return "Non-voice line.";
	if (answeredBy === "unknown") return "Treat as ambiguous until you listen.";
	return "";
}

export function amdLiveDisplay(args: {
	answeredBy: string | null | undefined;
	legStatus: string;
	amdMode: string | null | undefined;
	pstnJoined: boolean;
	pstnJoinedAt?: string | null | undefined;
}): { headline: string; subline: string; variant: AmdBadgeVariant } {
	const { answeredBy, legStatus, amdMode, pstnJoined } = args;

	if (answeredBy) {
		return {
			headline: amdTitle(answeredBy),
			subline: amdSubtitle(answeredBy),
			variant: amdBadgeVariant(answeredBy),
		};
	}

	const isConnected = legStatus === "connected" || legStatus === "answered";
	const isDetectEnd = amdMode === "DetectMessageEnd";
	const isEnable = amdMode === "Enable";

	if (isDetectEnd && pstnJoined && isConnected) {
		return {
			headline: "Audio live — greeting may be playing",
			subline:
				"Waiting for beep or end of greeting. If a real person picked up, you’ll usually see “Live person answered” shortly.",
			variant: "greeting",
		};
	}

	if (isEnable && pstnJoined && isConnected) {
		return {
			headline: "Audio live — checking for voicemail",
			subline:
				"Using faster machine detection on this list. Human vs. voicemail will update once classification finishes.",
			variant: "greeting",
		};
	}

	return {
		headline: amdTitle(undefined),
		subline: amdSubtitle(undefined),
		variant: "pending",
	};
}
