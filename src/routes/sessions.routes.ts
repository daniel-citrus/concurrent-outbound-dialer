import type { FastifyPluginAsync } from "fastify";
import {
  serializeCallAttempt,
  serializeContact,
  serializeEvent,
  serializeSession,
} from "../services/session-service.js";

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const svc = () => app.services.sessionService;

  app.post("/sessions", async (request, reply) => {
    const result = await svc().createSession(request.body);
    return reply.status(201).send({
      ...serializeSession(result.session),
      contacts: result.contacts.map(serializeContact),
    });
  });

  app.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    async (request) => {
      const session = await svc().getSession(request.params.sessionId);
      return serializeSession(session);
    },
  );

  app.get<{
    Params: { sessionId: string };
    Querystring: { afterVersion?: string };
  }>("/sessions/:sessionId/status", async (request, reply) => {
    const afterVersion =
      request.query.afterVersion !== undefined
        ? Number(request.query.afterVersion)
        : undefined;
    if (afterVersion !== undefined && Number.isNaN(afterVersion)) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "afterVersion must be a number",
          requestId: request.requestId,
        },
      });
    }

    const snapshot = await svc().getStatusSnapshot(
      request.params.sessionId,
      afterVersion,
    );
    if (!snapshot) {
      return reply.status(204).send();
    }

    return {
      ...snapshot,
      winningCall: snapshot.winningCall
        ? serializeCallAttempt(snapshot.winningCall)
        : null,
      activeCalls: snapshot.activeCalls.map(serializeCallAttempt),
    };
  });

  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string; offset?: string };
  }>("/sessions/:sessionId/contacts", async (request) => {
    const contacts = await svc().listContacts(request.params.sessionId, {
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      offset: request.query.offset ? Number(request.query.offset) : undefined,
    });
    return contacts.map(serializeContact);
  });

  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string; offset?: string };
  }>("/sessions/:sessionId/calls", async (request) => {
    const calls = await svc().listCalls(request.params.sessionId, {
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      offset: request.query.offset ? Number(request.query.offset) : undefined,
    });
    return calls.map(serializeCallAttempt);
  });

  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string; offset?: string };
  }>("/sessions/:sessionId/events", async (request) => {
    const events = await svc().listEvents(request.params.sessionId, {
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      offset: request.query.offset ? Number(request.query.offset) : undefined,
    });
    return events.map(serializeEvent);
  });

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/start",
    async (request) => {
      const session = await svc().start(request.params.sessionId);
      return serializeSession(session);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/pause",
    async (request) => {
      const session = await svc().pause(request.params.sessionId);
      return serializeSession(session);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/resume",
    async (request) => {
      const session = await svc().resume(request.params.sessionId);
      return serializeSession(session);
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/stop",
    async (request) => {
      const session = await svc().stop(request.params.sessionId);
      return serializeSession(session);
    },
  );
};
