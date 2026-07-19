import type { CallAttemptStatus } from "../domain/statuses.js";
import type { DialingSession } from "../domain/session.js";
import type { DialingContact } from "../domain/contact.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { DialEvent } from "../domain/event.js";
import type { DialEventType, ContactStatus, SessionStatus } from "../domain/statuses.js";

type SessionRow = {
  id: string;
  client_id: string;
  agent_id: string;
  status: SessionStatus;
  concurrency_limit: number;
  winning_call_attempt_id: string | null;
  state_version: number;
  created_at: Date;
  started_at: Date | null;
  paused_at: Date | null;
  stopped_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

type ContactRow = {
  id: string;
  session_id: string;
  external_contact_id: string;
  phone_number: string;
  position: number;
  status: ContactStatus;
  claimed_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type CallAttemptRow = {
  id: string;
  session_id: string;
  contact_id: string;
  provider_call_id: string | null;
  status: CallAttemptStatus;
  is_winner: boolean;
  permit_released: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  answered_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

type EventRow = {
  id: string;
  session_id: string;
  call_attempt_id: string | null;
  event_type: DialEventType;
  payload: Record<string, unknown>;
  created_at: Date;
};

export function mapSession(row: SessionRow): DialingSession {
  return {
    id: row.id,
    clientId: row.client_id,
    agentId: row.agent_id,
    status: row.status,
    concurrencyLimit: row.concurrency_limit,
    winningCallAttemptId: row.winning_call_attempt_id,
    stateVersion: row.state_version,
    createdAt: row.created_at,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    stoppedAt: row.stopped_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export function mapContact(row: ContactRow): DialingContact {
  return {
    id: row.id,
    sessionId: row.session_id,
    externalContactId: row.external_contact_id,
    phoneNumber: row.phone_number,
    position: row.position,
    status: row.status,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCallAttempt(row: CallAttemptRow): CallAttempt {
  return {
    id: row.id,
    sessionId: row.session_id,
    contactId: row.contact_id,
    providerCallId: row.provider_call_id,
    status: row.status,
    isWinner: row.is_winner,
    permitReleased: row.permit_released,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export function mapEvent(row: EventRow): DialEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    callAttemptId: row.call_attempt_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  };
}

export type { SessionRow, ContactRow, CallAttemptRow, EventRow };
