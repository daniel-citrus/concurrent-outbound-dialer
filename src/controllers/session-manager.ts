import type { Logger } from "pino";
import type { DialerSupabase } from "../database/supabase.js";
import type { DialingSession } from "../domain/session.js";
import { isTerminalSessionStatus } from "../domain/statuses.js";
import { sessionNotFound } from "../domain/errors.js";
import { SessionRepository } from "../repositories/session.repository.js";
import { CallAttemptRepository } from "../repositories/call-attempt.repository.js";
import { EventRepository } from "../repositories/event.repository.js";
import { SessionController } from "./session-controller.js";

export interface SessionManager {
  get(sessionId: string): SessionController | undefined;
  getOrCreate(sessionId: string): Promise<SessionController>;
  register(controller: SessionController): void;
  removeIfInactive(sessionId: string): Promise<void>;
  listActiveControllers(): SessionController[];
  clear(): void;
}

export class InMemorySessionManager implements SessionManager {
  private readonly controllers = new Map<string, SessionController>();
  private readonly initializing = new Map<string, Promise<SessionController>>();

  constructor(
    private readonly db: DialerSupabase,
    private readonly logger: Logger,
  ) {}

  get(sessionId: string): SessionController | undefined {
    return this.controllers.get(sessionId);
  }

  register(controller: SessionController): void {
    this.controllers.set(controller.sessionId, controller);
  }

  listActiveControllers(): SessionController[] {
    return [...this.controllers.values()];
  }

  clear(): void {
    this.controllers.clear();
    this.initializing.clear();
  }

  async getOrCreate(sessionId: string): Promise<SessionController> {
    const existing = this.controllers.get(sessionId);
    if (existing) {
      return existing;
    }

    const pending = this.initializing.get(sessionId);
    if (pending) {
      return pending;
    }

    const promise = this.createController(sessionId).finally(() => {
      this.initializing.delete(sessionId);
    });
    this.initializing.set(sessionId, promise);
    return promise;
  }

  private async createController(sessionId: string): Promise<SessionController> {
    const again = this.controllers.get(sessionId);
    if (again) {
      return again;
    }

    const sessions = new SessionRepository(this.db);
    const attempts = new CallAttemptRepository(this.db);
    const events = new EventRepository(this.db);

    const session = await sessions.findById(sessionId);
    if (!session) {
      throw sessionNotFound(sessionId);
    }

    const controller = await this.buildFromSession(session, attempts);
    this.controllers.set(sessionId, controller);

    await events.append({
      sessionId,
      eventType: "controller_created",
      payload: {
        concurrencyLimit: controller.concurrencyLimit,
        activeCalls: controller.activeCalls.size,
      },
    });

    this.logger.info(
      {
        sessionId,
        clientId: session.clientId,
        agentId: session.agentId,
        concurrencyLimit: session.concurrencyLimit,
      },
      "session controller created",
    );

    return controller;
  }

  async buildFromSession(
    session: DialingSession,
    attempts = new CallAttemptRepository(this.db),
  ): Promise<SessionController> {
    const controller = new SessionController({
      sessionId: session.id,
      clientId: session.clientId,
      agentId: session.agentId,
      concurrencyLimit: session.concurrencyLimit,
      status: session.status,
    });

    const active = await attempts.listActiveBySession(session.id);
    for (const attempt of active) {
      if (attempt.permitReleased) {
        continue;
      }
      await controller.acquirePermitForRecovery(attempt.id, attempt.providerCallId);
    }

    return controller;
  }

  async removeIfInactive(sessionId: string): Promise<void> {
    const controller = this.controllers.get(sessionId);
    if (!controller) {
      return;
    }

    const sessions = new SessionRepository(this.db);
    const session = await sessions.findById(sessionId);
    if (!session) {
      this.controllers.delete(sessionId);
      return;
    }

    if (!isTerminalSessionStatus(session.status)) {
      return;
    }

    if (!controller.isSafeToRemove(true)) {
      return;
    }

    this.controllers.delete(sessionId);
    const events = new EventRepository(this.db);
    await events.append({
      sessionId,
      eventType: "controller_removed",
      payload: { status: session.status },
    });

    this.logger.info({ sessionId, status: session.status }, "session controller removed");
  }
}
