import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    let database = "unknown";
    try {
      await app.services.db.query("SELECT 1");
      database = "ok";
    } catch {
      database = "error";
    }

    return {
      status: database === "ok" ? "ok" : "degraded",
      voiceProvider: app.services.env.VOICE_PROVIDER,
      database,
      timestamp: new Date().toISOString(),
    };
  });
};
