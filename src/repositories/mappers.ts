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
  auto_continue: boolean;
  state_version: number;
  created_at: Date | string;
  started_at: Date | string | null;
  paused_at: Date | string | null;
  stopped_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
};

type ContactRow = {
  id: string;
  session_id: string;
  external_contact_id: string;
  phone_number: string;
  position: number;
  status: ContactStatus;
  claimed_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
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
  created_at: Date | string;
  answered_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
};

type EventRow = {
  id: string;
  session_id: string;
  call_attempt_id: string | null;
  event_type: DialEventType;
  payload: Record<string, unknown>;
  created_at: Date | string;
};

function asDate(value: Date | string): Date;
function asDate(value: Date | string | null | undefined): Date | null;
function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

export function mapSession(row: SessionRow): DialingSession {
  return {
    id: row.id,
    clientId: row.client_id,
    agentId: row.agent_id,
    status: row.status,
    concurrencyLimit: row.concurrency_limit,
    winningCallAttemptId: row.winning_call_attempt_id,
    autoContinue: row.auto_continue,
    stateVersion: row.state_version,
    createdAt: asDate(row.created_at),
    startedAt: asDate(row.started_at),
    pausedAt: asDate(row.paused_at),
    stoppedAt: asDate(row.stopped_at),
    completedAt: asDate(row.completed_at),
    updatedAt: asDate(row.updated_at),
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
    claimedAt: asDate(row.claimed_at),
    completedAt: asDate(row.completed_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
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
    createdAt: asDate(row.created_at),
    answeredAt: asDate(row.answered_at),
    completedAt: asDate(row.completed_at),
    updatedAt: asDate(row.updated_at),
  };
}

export function mapEvent(row: EventRow): DialEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    callAttemptId: row.call_attempt_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    createdAt: asDate(row.created_at),
  };
}

export type { SessionRow, ContactRow, CallAttemptRow, EventRow };
