import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { DomainError, unauthorized } from "../domain/errors.js";

// Use a loose app type to avoid Fastify/Pino logger generic mismatches.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = FastifyInstance<any, any, any, any, any>;

export function registerRequestContext(app: AnyApp): void {
  app.addHook("onRequest", async (request) => {
    const header = request.headers["x-request-id"];
    const requestId =
      typeof header === "string" && header.length > 0 ? header : randomUUID();
    request.requestId = requestId;
    request.log = request.log.child({ requestId });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header("x-request-id", request.requestId);
    return payload;
  });
}

export function registerErrorHandler(app: AnyApp): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    const err = error as { validation?: unknown; message?: string };
    if (err.validation) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: err.message ?? "Validation error",
          requestId: request.requestId,
        },
      });
    }

    request.log.error({ err: error }, "unhandled error");

    const isProd = app.services?.env?.NODE_ENV === "production";
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: isProd ? "Internal server error" : message,
        requestId: request.requestId,
      },
    });
  });
}

export function registerServiceApiKey(app: AnyApp): void {
  app.addHook("onRequest", async (request) => {
    const configured = app.services.env.SERVICE_API_KEY;
    if (!configured) {
      return;
    }

    if (request.url === "/health" || request.url.startsWith("/health?")) {
      return;
    }

    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw unauthorized();
    }
    const token = header.slice("Bearer ".length).trim();
    if (token !== configured) {
      throw unauthorized();
    }
  });
}
