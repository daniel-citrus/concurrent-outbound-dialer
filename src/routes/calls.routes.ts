import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SIMULATABLE_CALL_STATUSES } from "../domain/statuses.js";
import { validationError } from "../domain/errors.js";
import { serializeCallAttempt } from "../services/session-service.js";

const statusSchema = z.object({
  status: z.enum(SIMULATABLE_CALL_STATUSES as unknown as [string, ...string[]]),
});

const createdSchema = z.object({
  providerCallId: z.string().min(1),
});

const creationFailedSchema = z.object({
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const callRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { callAttemptId: string } }>(
    "/calls/:callAttemptId/report-status",
    async (request) => {
      const parsed = statusSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError(
          `Invalid status. Supported: ${SIMULATABLE_CALL_STATUSES.join(", ")}`,
        );
      }

      const result = await app.services.callStatusProcessor.processStatus(
        request.params.callAttemptId,
        parsed.data.status as (typeof SIMULATABLE_CALL_STATUSES)[number],
      );

      return {
        ...serializeCallAttempt(result.attempt),
        sessionId: result.sessionId,
        triggeredReconcile: result.triggeredReconcile,
        winnerSelected: result.winnerSelected,
        winningCallAttemptId: result.winningCallAttemptId,
      };
    },
  );

  /** @deprecated Prefer POST /calls/:id/report-status */
  app.post<{ Params: { callAttemptId: string } }>(
    "/calls/:callAttemptId/simulate",
    async (request) => {
      const parsed = statusSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError(
          `Invalid status. Supported: ${SIMULATABLE_CALL_STATUSES.join(", ")}`,
        );
      }

      const result = await app.services.callStatusProcessor.processStatus(
        request.params.callAttemptId,
        parsed.data.status as (typeof SIMULATABLE_CALL_STATUSES)[number],
      );

      return {
        ...serializeCallAttempt(result.attempt),
        sessionId: result.sessionId,
        triggeredReconcile: result.triggeredReconcile,
        winnerSelected: result.winnerSelected,
        winningCallAttemptId: result.winningCallAttemptId,
      };
    },
  );

  app.post<{ Params: { callAttemptId: string } }>(
    "/calls/:callAttemptId/created",
    async (request) => {
      const parsed = createdSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("providerCallId is required");
      }
      const attempt = await app.services.callLaunch.markCallCreated(
        request.params.callAttemptId,
        parsed.data.providerCallId,
      );
      return serializeCallAttempt(attempt);
    },
  );

  app.post<{ Params: { callAttemptId: string } }>(
    "/calls/:callAttemptId/creation-failed",
    async (request) => {
      const parsed = creationFailedSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw validationError("Invalid creation-failed body");
      }
      const attempt = await app.services.callLaunch.markCallCreationFailed(
        request.params.callAttemptId,
        parsed.data,
      );
      return serializeCallAttempt(attempt);
    },
  );
};
