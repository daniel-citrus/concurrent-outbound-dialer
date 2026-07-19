import type { DialEventType } from "./statuses.js";

export type DialEvent = {
  id: string;
  sessionId: string;
  callAttemptId: string | null;
  eventType: DialEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
};
