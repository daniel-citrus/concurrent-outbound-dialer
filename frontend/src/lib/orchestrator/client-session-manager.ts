import {
  ClientSessionController,
  type ClientSessionControllerInit,
} from "./client-session-controller";

export class ClientSessionManager {
  private readonly controllers = new Map<string, ClientSessionController>();

  get(sessionId: string): ClientSessionController | undefined {
    return this.controllers.get(sessionId);
  }

  getOrCreate(init: ClientSessionControllerInit): ClientSessionController {
    const existing = this.controllers.get(init.sessionId);
    if (existing) {
      existing.status = init.status;
      return existing;
    }
    const controller = new ClientSessionController(init);
    this.controllers.set(init.sessionId, controller);
    return controller;
  }

  clear(): void {
    this.controllers.clear();
  }

  remove(sessionId: string): void {
    this.controllers.delete(sessionId);
  }
}
