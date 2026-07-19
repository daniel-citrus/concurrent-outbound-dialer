import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SIMULATABLE_CALL_STATUSES } from "../domain/statuses.js";
import { validationError } from "../domain/errors.js";
import { serializeCallAttempt } from "../services/session-service.js";

const simulateSchema = z.object({
  status: z.enum(
    SIMULATABLE_CALL_STATUSES as unknown as [string, ...string[]],
  ),
});

export const callRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { callAttemptId: string } }>(
    "/calls/:callAttemptId/simulate",
    async (request) => {
      const parsed = simulateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError(
          `Invalid status. Supported: ${SIMULATABLE_CALL_STATUSES.join(", ")}`,
        );
      }

      const attempt = await app.services.callStatusProcessor.processStatus(
        request.params.callAttemptId,
        parsed.data.status as (typeof SIMULATABLE_CALL_STATUSES)[number],
      );

      return serializeCallAttempt(attempt);
    },
  );
};
