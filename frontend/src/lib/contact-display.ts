import type { NebulaProspectContact } from "./types";

export function formatTimeAgo(value: string | null): string {
  if (!value) return "—";

  const then = new Date(value).getTime();
  const diffMs = Date.now() - then;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return new Date(value).toLocaleDateString();
}

export function formatActivity(value: string): string {
  return value.replaceAll("_", " ");
}

export function fallbackContactDetail(
  externalContactId: string,
  phoneNumber = "—",
): NebulaProspectContact {
  return {
    externalContactId,
    phoneNumber,
    name: externalContactId,
    company: "—",
    title: "—",
    activity: "—",
    status: "—",
    emailStatus: null,
    lastOutboundAt: null,
    lastOutboundType: null,
    lastInboundAt: null,
    lastInboundType: null,
  };
}
