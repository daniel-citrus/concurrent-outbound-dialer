import type { FastifyPluginAsync } from "fastify";

/** Events are exposed under session routes; kept for structure parity. */
export const eventRoutes: FastifyPluginAsync = async () => {
  // no-op placeholder; session events live at GET /sessions/:id/events
};
