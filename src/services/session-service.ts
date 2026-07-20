import { z } from "zod";
import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import { withTransaction } from "../database/pool.js";
import type { DialingSession } from "../domain/session.js";
import type { DialingContact } from "../domain/contact.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import type { DialEvent } from "../domain/event.js";
import {
  canPauseSession,
  canResumeSession,
  canStartSession,
  canStopSession,
} from "../domain/statuses.js";
import {
  invalidContactInput,
  invalidSessionTransition,
  sessionNotFound,
  validationError,
} from "../domain/errors.js";
import type { SessionManager } from "../controllers/session-manager.js";
import type { SessionOrchestrator } from "./session-orchestrator.js";
import type { CallCanceler } from "./call-canceler.js";
import { SessionRepository } from "../repositories/session.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { EventRepository } from "../repositories/event.repository.js";

const e164Like = /^\+[1-9]\d{6,14}$/;

const createSessionSchema = z.object({
  clientId: z.string().min(1),
  agentId: z.string().min(1),
  concurrencyLimit: z.number().int().min(1).max(10),
  contacts: z
    .array(
      z.object({
        externalContactId: z.string().min(1),
        phoneNumber: z.string().min(1),
      }),
    )
    .min(1),
});

export type CreateSessionBody = z.infer<typeof createSessionSchema>;

export type SessionStatusSnapshot = {
  sessionId: string;
  clientId: string;
  agentId: string;
  status: string;
  concurrencyLimit: number;
  stateVersion: number;
  activeCallCount: number;
  queuedContactCount: number;
  completedContactCount: number;
  failedContactCount: number;
  winningCall: CallAttempt | null;
  activeCalls: CallAttempt[];
  updatedAt: string;
};

export type SessionRuntimeResource = {
  callAttemptId: string;
  providerCallId: string | null;
  permitReleased: boolean;
  contactId: string | null;
  phoneNumber: string | null;
  callStatus: string | null;
};

export type SessionRuntimeSnapshot = {
  sessionId: string;
  sessionStatus: string;
  concurrencyLimit: number;
  controllerPresent: boolean;
  semaphore: {
    capacity: number;
    availablePermits: number;
    occupiedPermits: number;
    waiters: number;
  };
  mutex: {
    locked: boolean;
    resource: "reconciliation";
  };
  orchestrator: {
    reconcileRunning: boolean;
    reconcileQueued: boolean;
  };
  reconciliationPending: boolean;
  resources: SessionRuntimeResource[];
};

export class SessionService {
  constructor(
    private readonly db: DbPool,
    private readonly sessionManager: SessionManager,
    private readonly orchestrator: SessionOrchestrator,
    private readonly callCanceler: CallCanceler,
    private readonly logger: Logger,
  ) {}

  async createSession(raw: unknown): Promise<{
    session: DialingSession;
    contacts: DialingContact[];
  }> {
    const parsed = createSessionSchema.safeParse(raw);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const input = parsed.data;

    const externalIds = new Set<string>();
    for (const contact of input.contacts) {
      if (externalIds.has(contact.externalContactId)) {
        throw invalidContactInput(
          `Duplicate externalContactId: ${contact.externalContactId}`,
        );
      }
      externalIds.add(contact.externalContactId);
      if (!e164Like.test(contact.phoneNumber)) {
        throw invalidContactInput(
          `Phone number must be E.164-like: ${contact.phoneNumber}`,
        );
      }
    }

    return withTransaction(this.db, async (client) => {
      const sessions = new SessionRepository(client);
      const contactsRepo = new ContactRepository(client);
      const events = new EventRepository(client);

      const session = await sessions.create(client, {
        clientId: input.clientId,
        agentId: input.agentId,
        concurrencyLimit: input.concurrencyLimit,
      });

      const contacts = await contactsRepo.insertMany(client, session.id, input.contacts);
      await events.append(
        {
          sessionId: session.id,
          eventType: "session_created",
          payload: {
            clientId: session.clientId,
            agentId: session.agentId,
            contactCount: contacts.length,
            concurrencyLimit: session.concurrencyLimit,
          },
        },
        client,
      );

      return { session, contacts };
    });
  }

  async getSession(sessionId: string): Promise<DialingSession> {
    const sessions = new SessionRepository(this.db);
    const session = await sessions.findById(sessionId);
    if (!session) throw sessionNotFound(sessionId);
    return session;
  }

  async listContacts(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<DialingContact[]> {
    await this.getSession(sessionId);
    return new ContactRepository(this.db).listBySession(sessionId, options);
  }

  async listCalls(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<CallAttempt[]> {
    await this.getSession(sessionId);
    return new CallAttemptRepository(this.db).listBySession(sessionId, options);
  }

  async listEvents(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<DialEvent[]> {
    await this.getSession(sessionId);
    return new EventRepository(this.db).listBySession(sessionId, options);
  }

  async getStatusSnapshot(
    sessionId: string,
    afterVersion?: number,
  ): Promise<SessionStatusSnapshot | null> {
    const session = await this.getSession(sessionId);
    if (afterVersion !== undefined && session.stateVersion <= afterVersion) {
      return null;
    }

    const contacts = new ContactRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const counts = await contacts.countByStatus(sessionId);
    const activeCalls = await attempts.listActiveBySession(sessionId);
    let winningCall: CallAttempt | null = null;
    if (session.winningCallAttemptId) {
      winningCall = await attempts.findById(session.winningCallAttemptId);
    }

    return {
      sessionId: session.id,
      clientId: session.clientId,
      agentId: session.agentId,
      status: session.status,
      concurrencyLimit: session.concurrencyLimit,
      stateVersion: session.stateVersion,
      activeCallCount: activeCalls.length,
      queuedContactCount: counts["queued"] ?? 0,
      completedContactCount: (counts["completed"] ?? 0) + (counts["answered"] ?? 0),
      failedContactCount: counts["failed"] ?? 0,
      winningCall,
      activeCalls,
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  async getRuntimeSnapshot(sessionId: string): Promise<SessionRuntimeSnapshot> {
    const session = await this.getSession(sessionId);
    const controller = this.sessionManager.get(sessionId);
    const orchestrator = this.orchestrator.getReconcileState(sessionId);
    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const activeAttempts = await attempts.listActiveBySession(sessionId);
    const contactRows = await contacts.listBySession(sessionId);
    const contactById = new Map(contactRows.map((contact) => [contact.id, contact]));

    if (!controller) {
      return {
        sessionId: session.id,
        sessionStatus: session.status,
        concurrencyLimit: session.concurrencyLimit,
        controllerPresent: false,
        semaphore: {
          capacity: session.concurrencyLimit,
          availablePermits: session.concurrencyLimit,
          occupiedPermits: 0,
          waiters: 0,
        },
        mutex: {
          locked: false,
          resource: "reconciliation",
        },
        orchestrator: {
          reconcileRunning: orchestrator.running,
          reconcileQueued: orchestrator.queued,
        },
        reconciliationPending: false,
        resources: [],
      };
    }

    const resources = [...controller.activeCalls.values()].map((state) => {
      const attempt = activeAttempts.find((row) => row.id === state.callAttemptId);
      const contact = attempt ? contactById.get(attempt.contactId) : undefined;

      return {
        callAttemptId: state.callAttemptId,
        providerCallId: state.providerCallId,
        permitReleased: state.permitReleased,
        contactId: attempt?.contactId ?? null,
        phoneNumber: contact?.phoneNumber ?? null,
        callStatus: attempt?.status ?? null,
      };
    });

    return {
      sessionId: session.id,
      sessionStatus: controller.status,
      concurrencyLimit: controller.concurrencyLimit,
      controllerPresent: true,
      semaphore: {
        capacity: controller.concurrencyLimit,
        availablePermits: controller.availablePermits(),
        occupiedPermits: controller.occupiedPermits(),
        waiters: controller.semaphoreWaiterCount(),
      },
      mutex: {
        locked: controller.reconciliationMutex.isLocked(),
        resource: "reconciliation",
      },
      orchestrator: {
        reconcileRunning: orchestrator.running,
        reconcileQueued: orchestrator.queued,
      },
      reconciliationPending: controller.reconciliationPending,
      resources,
    };
  }

  async start(sessionId: string): Promise<DialingSession> {
    const sessions = new SessionRepository(this.db);
    const events = new EventRepository(this.db);
    const session = await this.getSession(sessionId);

    if (!canStartSession(session.status)) {
      throw invalidSessionTransition(
        `Session cannot be started from status ${session.status}.`,
      );
    }

    const updated = await sessions.updateStatus(sessionId, "running", {
      startedAt: session.startedAt ?? new Date(),
      pausedAt: null,
      expectedStatuses: ["created", "paused"],
    });
    if (!updated) {
      throw invalidSessionTransition("Session start raced with another transition.");
    }

    await events.append({
      sessionId,
      eventType: "session_started",
      payload: { from: session.status },
    });

    const controller = await this.sessionManager.getOrCreate(sessionId);
    controller.status = "running";
    this.orchestrator.scheduleReconcile(sessionId);

    this.logger.info(
      { sessionId, clientId: session.clientId, agentId: session.agentId },
      "session started",
    );

    return updated;
  }

  async pause(sessionId: string): Promise<DialingSession> {
    const sessions = new SessionRepository(this.db);
    const events = new EventRepository(this.db);
    const session = await this.getSession(sessionId);

    if (!canPauseSession(session.status)) {
      throw invalidSessionTransition(
        `Session cannot be paused from status ${session.status}.`,
      );
    }

    const updated = await sessions.updateStatus(sessionId, "paused", {
      pausedAt: new Date(),
      expectedStatuses: ["running"],
    });
    if (!updated) {
      throw invalidSessionTransition("Session pause raced with another transition.");
    }

    await events.append({
      sessionId,
      eventType: "session_paused",
      payload: {},
    });

    const controller = this.sessionManager.get(sessionId);
    if (controller) {
      controller.status = "paused";
    }

    void this.callCanceler.cancelAllActiveCalls(sessionId).catch((error: unknown) => {
      this.logger.error({ err: error, sessionId }, "pause cancellation failed");
    });

    return updated;
  }

  async resume(sessionId: string): Promise<DialingSession> {
    const sessions = new SessionRepository(this.db);
    const events = new EventRepository(this.db);
    const session = await this.getSession(sessionId);

    if (!canResumeSession(session.status)) {
      throw invalidSessionTransition(
        `Session cannot be resumed from status ${session.status}.`,
      );
    }

    const updated = await sessions.updateStatus(sessionId, "running", {
      pausedAt: null,
      expectedStatuses: ["paused"],
    });
    if (!updated) {
      throw invalidSessionTransition("Session resume raced with another transition.");
    }

    await events.append({
      sessionId,
      eventType: "session_resumed",
      payload: {},
    });

    const controller = await this.sessionManager.getOrCreate(sessionId);
    controller.status = "running";
    this.orchestrator.scheduleReconcile(sessionId);

    return updated;
  }

  async stop(sessionId: string): Promise<DialingSession> {
    const sessions = new SessionRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const events = new EventRepository(this.db);
    const session = await this.getSession(sessionId);

    if (session.status === "stopped") {
      return session;
    }

    if (session.status === "completed" || session.status === "failed") {
      return session;
    }

    if (!canStopSession(session.status) && session.status !== "stopping") {
      throw invalidSessionTransition(
        `Session cannot be stopped from status ${session.status}.`,
      );
    }

    let current = session;
    if (session.status !== "stopping") {
      const updated = await sessions.updateStatus(sessionId, "stopping", {
        expectedStatuses: [
          "created",
          "running",
          "paused",
          "winner_selected",
        ],
      });
      if (updated) {
        current = updated;
        await events.append({
          sessionId,
          eventType: "session_stopping",
          payload: {},
        });
        const controller = this.sessionManager.get(sessionId);
        if (controller) controller.status = "stopping";
      }
    }

    await this.callCanceler.cancelAllActiveCalls(sessionId);

    const active = await attempts.countActiveBySession(sessionId);
    if (active === 0) {
      const stopped = await sessions.updateStatus(sessionId, "stopped", {
        stoppedAt: new Date(),
        expectedStatuses: ["stopping", "created", "running", "paused", "winner_selected"],
      });
      if (stopped) {
        await events.append({
          sessionId,
          eventType: "session_stopped",
          payload: {},
        });
        const controller = this.sessionManager.get(sessionId);
        if (controller) controller.status = "stopped";
        await this.sessionManager.removeIfInactive(sessionId);
        return stopped;
      }
    }

    return (await sessions.findById(sessionId)) ?? current;
  }
}

export function serializeSession(session: DialingSession) {
  return {
    id: session.id,
    clientId: session.clientId,
    agentId: session.agentId,
    status: session.status,
    concurrencyLimit: session.concurrencyLimit,
    winningCallAttemptId: session.winningCallAttemptId,
    stateVersion: session.stateVersion,
    createdAt: session.createdAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    pausedAt: session.pausedAt?.toISOString() ?? null,
    stoppedAt: session.stoppedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    updatedAt: session.updatedAt.toISOString(),
  };
}

export function serializeContact(contact: DialingContact) {
  return {
    id: contact.id,
    sessionId: contact.sessionId,
    externalContactId: contact.externalContactId,
    phoneNumber: contact.phoneNumber,
    position: contact.position,
    status: contact.status,
    claimedAt: contact.claimedAt?.toISOString() ?? null,
    completedAt: contact.completedAt?.toISOString() ?? null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function serializeCallAttempt(attempt: CallAttempt) {
  return {
    id: attempt.id,
    sessionId: attempt.sessionId,
    contactId: attempt.contactId,
    providerCallId: attempt.providerCallId,
    status: attempt.status,
    isWinner: attempt.isWinner,
    permitReleased: attempt.permitReleased,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
    createdAt: attempt.createdAt.toISOString(),
    answeredAt: attempt.answeredAt?.toISOString() ?? null,
    completedAt: attempt.completedAt?.toISOString() ?? null,
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

export function serializeEvent(event: DialEvent) {
  return {
    id: event.id,
    sessionId: event.sessionId,
    callAttemptId: event.callAttemptId,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  };
}
