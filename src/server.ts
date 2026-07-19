import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { closePool } from "./database/pool.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env, runRecovery: true });

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "graceful shutdown started");

    app.services.orchestrator.stopAcceptingWork();

    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, "error closing http server");
    }

    try {
      await closePool();
    } catch (error) {
      app.log.error({ err: error }, "error closing database pool");
    }

    app.log.info("graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info({ host: env.HOST, port: env.PORT }, "dialer service listening");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
