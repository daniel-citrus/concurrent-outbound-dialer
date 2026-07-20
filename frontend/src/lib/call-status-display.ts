import type { CallAttempt, CallAttemptStatus } from "./types";
import { formatStatus, isActiveCall } from "./types";

export type CallStatusTone =
  | "winner"
  | "ringing"
  | "answered"
  | "dialing"
  | "completed"
  | "no-answer"
  | "busy"
  | "failed"
  | "canceled"
  | "open"
  | "neutral";

export function callStatusTone(
  status: string,
  options?: { isWinner?: boolean },
): CallStatusTone {
  if (options?.isWinner || status === "winner") {
    return "winner";
  }

  switch (status as CallAttemptStatus | "open") {
    case "ringing":
      return "ringing";
    case "in_progress":
      return "answered";
    case "creating":
    case "queued":
    case "initiated":
      return "dialing";
    case "completed":
      return "completed";
    case "no_answer":
      return "no-answer";
    case "busy":
      return "busy";
    case "failed":
    case "unknown":
      return "failed";
    case "canceled":
      return "canceled";
    case "open":
      return "open";
    default:
      return "neutral";
  }
}

export function resolveContactCallStatus(
  contactId: string,
  calls: CallAttempt[],
): { label: string; tone: CallStatusTone } {
  const attempts = calls.filter((call) => call.contactId === contactId);
  if (attempts.length === 0) {
    return { label: "—", tone: "neutral" };
  }

  const winner = attempts.find((call) => call.isWinner);
  if (winner) {
    return { label: "winner", tone: "winner" };
  }

  const active = attempts.find((call) => isActiveCall(call.status));
  if (active) {
    return {
      label: formatStatus(active.status),
      tone: callStatusTone(active.status),
    };
  }

  const latest = [...attempts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0]!;

  return {
    label: formatStatus(latest.status),
    tone: callStatusTone(latest.status),
  };
}
