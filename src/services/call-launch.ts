import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import { withTransaction } from "../database/pool.js";
import type { CallAttempt } from "../domain/call-attempt.js";
import {
  DomainError,
  callAttemptNotFound,
  sessionNotFound,
  validationError,
} from "../domain/errors.js";
import { calculateLaunchCount } from "../domain/statuses.js";
import type { SessionManager } from "../controllers/session-manager.js";
import { claimContactsAndReserveAttempts, type ReservedClaim } from "../repositories/claim.repository.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { EventRepository } from "../repositories/event.repository.js";
import { SessionRepository } from "../repositories/session.repository.js";
import { tryCompleteSessionIfExhausted } from "./session-completion.js";

export type ReconcileHint = {
  sessionId: string;
  sessionStatus: string;
  concurrencyLimit: number;
  persistedActiveCount: number;
  queuedContactCount: number;
  claimedContactCount: number;
};

/**
 * Durable claim / create / fail steps used by the client orchestrator
 * (and by the integration test harness).
 */
export class CallLaunchService {
  constructor(
    private readonly db: DbPool,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger,
  ) {}

  async getReconcileHint(sessionId: string): Promise<ReconcileHint> {
    const sessions = new SessionRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const session = await sessions.findById(sessionId);
    if (!session) {
      throw sessionNotFound(sessionId);
    }
    const counts = await contacts.countByStatus(sessionId);
    return {
      sessionId: session.id,
      sessionStatus: session.status,
      concurrencyLimit: session.concurrencyLimit,
      persistedActiveCount: await attempts.countActiveBySession(sessionId),
      queuedContactCount: counts["queued"] ?? 0,
      claimedContactCount: counts["claimed"] ?? 0,
    };
  }

  /**
   * Claim up to `limit` contacts. When `locallyAvailablePermits` is provided,
   * applies the same capacity math as the client reconcile loop.
   */
  async claim(
    sessionId: string,
    limit: number,
    options?: { locallyAvailablePermits?: number },
  ): Promise<ReservedClaim[]> {
    if (!Number.isInteger(limit) || limit < 0) {
      throw validationError("limit must be a non-negative integer");
    }

    const sessions = new SessionRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const events = new EventRepository(this.db);

    const session = await sessions.findById(sessionId);
    if (!session) {
      throw sessionNotFound(sessionId);
    }

    if (session.status !== "running") {
      return [];
    }

    let launchCount = limit;
    if (options?.locallyAvailablePermits !== undefined) {
      const persistedActiveCount = await attempts.countActiveBySession(sessionId);
      launchCount = calculateLaunchCount({
        concurrencyLimit: session.concurrencyLimit,
        persistedActiveCount,
        locallyAvailablePermits: options.locallyAvailablePermits,
      });
    }

    if (launchCount <= 0) {
      await tryCompleteSessionIfExhausted(this.db, this.sessionManager, sessionId);
      return [];
    }

    const claims = await withTransaction(this.db, (client) =>
      claimContactsAndReserveAttempts(client, sessionId, launchCount),
    );

    if (claims.length === 0) {
      await tryCompleteSessionIfExhausted(this.db, this.sessionManager, sessionId);
      return [];
    }

    this.logger.info(
      { sessionId, launchCount: claims.length },
      "contacts claimed for launch",
    );

    await events.append({
      sessionId,
      eventType: "call_creation_requested",
      payload: { count: claims.length },
    });

    return claims;
  }

  async markCallCreated(
    callAttemptId: string,
    providerCallId: string,
  ): Promise<CallAttempt> {
    if (!providerCallId.trim()) {
      throw validationError("providerCallId is required");
    }

    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const events = new EventRepository(this.db);

    const attempt = await attempts.findById(callAttemptId);
    if (!attempt) {
      throw callAttemptNotFound(callAttemptId);
    }

    const updated = await attempts.updateStatus(callAttemptId, "queued", {
      providerCallId,
      expectedStatuses: ["creating"],
    });
    if (!updated) {
      const reloaded = await attempts.findById(callAttemptId);
      if (!reloaded) throw callAttemptNotFound(callAttemptId);
      return reloaded;
    }

    await contacts.updateStatus(attempt.contactId, "dialing");
    await events.append({
      sessionId: attempt.sessionId,
      callAttemptId: attempt.id,
      eventType: "call_created",
      payload: { providerCallId },
    });

    const controller = this.sessionManager.get(attempt.sessionId);
    controller?.setProviderCallId(attempt.id, providerCallId);

    return updated;
  }

  async markCallCreationFailed(
    callAttemptId: string,
    input: { errorCode?: string; errorMessage?: string },
  ): Promise<CallAttempt> {
    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const events = new EventRepository(this.db);

    const attempt = await attempts.findById(callAttemptId);
    if (!attempt) {
      throw callAttemptNotFound(callAttemptId);
    }

    const code = input.errorCode ?? "PROVIDER_FAILURE";
    const message = input.errorMessage ?? "provider failure";

    const updated = await attempts.updateStatus(callAttemptId, "failed", {
      errorCode: code,
      errorMessage: message,
      completedAt: new Date(),
      permitReleased: true,
      expectedStatuses: ["creating"],
    });

    if (!updated) {
      const reloaded = await attempts.findById(callAttemptId);
      if (!reloaded) throw callAttemptNotFound(callAttemptId);
      return reloaded;
    }

    await contacts.updateStatus(attempt.contactId, "failed", {
      completedAt: new Date(),
    });
    await events.append({
      sessionId: attempt.sessionId,
      callAttemptId: attempt.id,
      eventType: "call_creation_failed",
      payload: { error: message, code },
    });

    const controller = this.sessionManager.get(attempt.sessionId);
    controller?.releasePermit(attempt.id);

    this.logger.error(
      {
        sessionId: attempt.sessionId,
        callAttemptId: attempt.id,
        contactId: attempt.contactId,
        error: message,
      },
      "call creation failed",
    );

    return updated;
  }
}

export function serializeReservedClaim(claim: ReservedClaim) {
  return {
    contact: {
      id: claim.contact.id,
      sessionId: claim.contact.sessionId,
      externalContactId: claim.contact.externalContactId,
      phoneNumber: claim.contact.phoneNumber,
      position: claim.contact.position,
      status: claim.contact.status,
      claimedAt: claim.contact.claimedAt?.toISOString() ?? null,
      completedAt: claim.contact.completedAt?.toISOString() ?? null,
      createdAt: claim.contact.createdAt.toISOString(),
      updatedAt: claim.contact.updatedAt.toISOString(),
    },
    callAttempt: {
      id: claim.callAttempt.id,
      sessionId: claim.callAttempt.sessionId,
      contactId: claim.callAttempt.contactId,
      providerCallId: claim.callAttempt.providerCallId,
      status: claim.callAttempt.status,
      isWinner: claim.callAttempt.isWinner,
      permitReleased: claim.callAttempt.permitReleased,
      errorCode: claim.callAttempt.errorCode,
      errorMessage: claim.callAttempt.errorMessage,
      createdAt: claim.callAttempt.createdAt.toISOString(),
      answeredAt: claim.callAttempt.answeredAt?.toISOString() ?? null,
      completedAt: claim.callAttempt.completedAt?.toISOString() ?? null,
      updatedAt: claim.callAttempt.updatedAt.toISOString(),
    },
  };
}

export function toDomainErrorMessage(error: unknown): { code: string; message: string } {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "PROVIDER_FAILURE", message: error.message };
  }
  return { code: "PROVIDER_FAILURE", message: "provider failure" };
}
