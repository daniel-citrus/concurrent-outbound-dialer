import type { Logger } from "pino";
import type { DbPool } from "../database/pool.js";
import { withTransaction } from "../database/pool.js";
import type { Env } from "../config/env.js";
import type { VoiceProvider } from "../providers/voice-provider.js";
import type { SessionManager } from "../controllers/session-manager.js";
import type { SessionController } from "../controllers/session-controller.js";
import { DomainError } from "../domain/errors.js";
import { calculateLaunchCount } from "../domain/statuses.js";
import { SessionRepository } from "../repositories/session.repository.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { EventRepository } from "../repositories/event.repository.js";
import { claimContactsAndReserveAttempts } from "../repositories/claim.repository.js";

export class SessionOrchestrator {
  private acceptingWork = true;
  private readonly running = new Set<string>();
  private readonly queued = new Set<string>();

  constructor(
    private readonly db: DbPool,
    private readonly env: Env,
    private readonly voiceProvider: VoiceProvider,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger,
  ) {}

  stopAcceptingWork(): void {
    this.acceptingWork = false;
  }

  scheduleReconcile(sessionId: string): void {
    if (!this.acceptingWork) {
      return;
    }
    if (this.running.has(sessionId)) {
      this.queued.add(sessionId);
      return;
    }
    if (this.queued.has(sessionId)) {
      return;
    }
    this.queued.add(sessionId);
    queueMicrotask(() => {
      void this.drain(sessionId);
    });
  }

  getReconcileState(sessionId: string): { running: boolean; queued: boolean } {
    return {
      running: this.running.has(sessionId),
      queued: this.queued.has(sessionId),
    };
  }

  private async drain(sessionId: string): Promise<void> {
    while (this.acceptingWork && this.queued.has(sessionId)) {
      this.queued.delete(sessionId);
      this.running.add(sessionId);
      try {
        await this.reconcileSession(sessionId);
      } finally {
        this.running.delete(sessionId);
      }
    }
  }

  async reconcileSession(sessionId: string): Promise<void> {
    if (!this.acceptingWork) {
      return;
    }

    const controller = await this.sessionManager.getOrCreate(sessionId);
    controller.reconciliationPending = true;

    try {
      const reserved = await controller.reconciliationMutex.runExclusive(async () => {
        return this.reserveCapacity(controller);
      });

      if (reserved.length === 0) {
        return;
      }

      await Promise.allSettled(reserved.map((item) => this.launchReserved(controller, item)));
    } finally {
      controller.reconciliationPending = false;
      await this.sessionManager.removeIfInactive(sessionId);
    }
  }

  private async reserveCapacity(controller: SessionController) {
    const sessions = new SessionRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const events = new EventRepository(this.db);

    const session = await sessions.findById(controller.sessionId);
    if (!session) {
      return [];
    }

    controller.status = session.status;
    if (session.status !== "running") {
      return [];
    }

    const persistedActiveCount = await attempts.countActiveBySession(session.id);
    const locallyAvailable = controller.availablePermits();
    const launchCount = calculateLaunchCount({
      concurrencyLimit: session.concurrencyLimit,
      persistedActiveCount,
      locallyAvailablePermits: locallyAvailable,
    });

    if (launchCount <= 0) {
      await this.maybeCompleteSession(session.id, persistedActiveCount);
      return [];
    }

    const claims = await withTransaction(this.db, (client) =>
      claimContactsAndReserveAttempts(client, session.id, launchCount),
    );

    if (claims.length === 0) {
      const stillActive = await attempts.countActiveBySession(session.id);
      await this.maybeCompleteSession(session.id, stillActive);
      return [];
    }

    this.logger.info(
      {
        sessionId: session.id,
        launchCount: claims.length,
        persistedActiveCount,
        locallyAvailable,
      },
      "contacts claimed for launch",
    );

    await events.append({
      sessionId: session.id,
      eventType: "call_creation_requested",
      payload: { count: claims.length },
    });

    return claims;
  }

  private async launchReserved(
    controller: SessionController,
    item: Awaited<ReturnType<typeof claimContactsAndReserveAttempts>>[number],
  ): Promise<void> {
    const attempts = new CallAttemptRepository(this.db);
    const contacts = new ContactRepository(this.db);
    const events = new EventRepository(this.db);

    await controller.acquirePermitForAttempt(item.callAttempt.id);

    try {
      const result = await this.voiceProvider.createCall({
        sessionId: controller.sessionId,
        callAttemptId: item.callAttempt.id,
        contactId: item.contact.id,
        phoneNumber: item.contact.phoneNumber,
        statusCallbackUrl: `${this.env.PUBLIC_BASE_URL}/calls/${item.callAttempt.id}/simulate`,
      });

      controller.setProviderCallId(item.callAttempt.id, result.providerCallId);

      await attempts.updateStatus(item.callAttempt.id, "queued", {
        providerCallId: result.providerCallId,
        expectedStatuses: ["creating"],
      });
      await contacts.updateStatus(item.contact.id, "dialing");
      await events.append({
        sessionId: controller.sessionId,
        callAttemptId: item.callAttempt.id,
        eventType: "call_created",
        payload: { providerCallId: result.providerCallId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider failure";
      const code = error instanceof DomainError ? error.code : "PROVIDER_FAILURE";

      this.logger.error(
        {
          err: error,
          sessionId: controller.sessionId,
          callAttemptId: item.callAttempt.id,
          contactId: item.contact.id,
        },
        "call creation failed",
      );

      await attempts.updateStatus(item.callAttempt.id, "failed", {
        errorCode: code,
        errorMessage: message,
        completedAt: new Date(),
        permitReleased: true,
      });
      await contacts.updateStatus(item.contact.id, "failed", {
        completedAt: new Date(),
      });
      await events.append({
        sessionId: controller.sessionId,
        callAttemptId: item.callAttempt.id,
        eventType: "call_creation_failed",
        payload: { error: message },
      });

      controller.releasePermit(item.callAttempt.id);
      this.scheduleReconcile(controller.sessionId);
    }
  }

  private async maybeCompleteSession(
    sessionId: string,
    activeCount: number,
  ): Promise<void> {
    if (activeCount > 0) {
      return;
    }

    const contacts = new ContactRepository(this.db);
    const sessions = new SessionRepository(this.db);
    const events = new EventRepository(this.db);
    const counts = await contacts.countByStatus(sessionId);
    const queued = counts["queued"] ?? 0;
    const claimed = counts["claimed"] ?? 0;
    if (queued > 0 || claimed > 0) {
      return;
    }

    const completed = await sessions.markCompleted(sessionId);
    if (completed) {
      await events.append({
        sessionId,
        eventType: "session_completed",
        payload: {},
      });
      const controller = this.sessionManager.get(sessionId);
      if (controller) {
        controller.status = "completed";
      }
    }
  }
}
