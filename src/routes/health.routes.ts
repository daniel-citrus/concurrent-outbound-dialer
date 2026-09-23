import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    let database = "unknown";
    try {
      const { error } = await app.services.db
        .from("dialing_sessions")
        .select("id")
        .limit(1);
      database = error ? "error" : "ok";
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
