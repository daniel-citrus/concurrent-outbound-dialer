import type { ContactStatus } from "./statuses.js";

export type DialingContact = {
  id: string;
  sessionId: string;
  externalContactId: string;
  phoneNumber: string;
  position: number;
  status: ContactStatus;
  claimedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
