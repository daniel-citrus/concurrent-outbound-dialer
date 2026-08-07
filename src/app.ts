import Fastify from "fastify";
import pino from "pino";
import type { Env } from "./config/env.js";
import { loadEnv, resolveSupabaseCredentials } from "./config/env.js";
import { createDialerSupabase, type DialerSupabase } from "./database/supabase.js";
import { MockCallAutoSimulator } from "./providers/mock-call-auto-simulator.js";
import { MOCK_AUTO_SIMULATE_DEFAULTS } from "./providers/mock-call-auto-simulator.js";
import { MockVoiceProvider } from "./providers/mock-voice-provider.js";
import type { VoiceProvider } from "./providers/voice-provider.js";
import { InMemorySessionManager } from "./controllers/session-manager.js";
import { CallCanceler } from "./services/call-canceler.js";
import { WinnerSelector } from "./services/winner-selector.js";
import { CallStatusProcessor } from "./services/call-status-processor.js";
import { CallLaunchService } from "./services/call-launch.js";
import { SessionService } from "./services/session-service.js";
import { RecoveryService } from "./services/recovery-service.js";
import { healthRoutes } from "./routes/health.routes.js";
import { sessionRoutes } from "./routes/sessions.routes.js";
import { callRoutes } from "./routes/calls.routes.js";
import { mockRoutes } from "./routes/mock.routes.js";
import { nebulaRoutes } from "./routes/nebula.routes.js";
import type { AppServices } from "./types/app.js";
import {
  registerErrorHandler,
  registerRequestContext,
  registerServiceApiKey,
} from "./plugins/register.js";

export type BuildAppOptions = {
  env?: Env;
  db?: DialerSupabase;
  voiceProvider?: VoiceProvider;
  logger?: pino.Logger;
  runRecovery?: boolean;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const env = options.env ?? loadEnv();
  const logger =
    options.logger ??
    pino({
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "DATABASE_URL",
          "env.DATABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "env.SUPABASE_SERVICE_ROLE_KEY",
          "NEBULA_SUPABASE_SERVICE_ROLE_KEY",
          "env.NEBULA_SUPABASE_SERVICE_ROLE_KEY",
          "SERVICE_API_KEY",
          "env.SERVICE_API_KEY",
        ],
        remove: true,
      },
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    });

  const db =
    options.db ??
    (() => {
      const creds = resolveSupabaseCredentials(env);
      return createDialerSupabase(creds.url, creds.serviceRoleKey);
    })();

  const autoSimulator = env.MOCK_AUTO_SIMULATE
    ? new MockCallAutoSimulator({
        ...MOCK_AUTO_SIMULATE_DEFAULTS,
        answerRate: env.MOCK_AUTO_ANSWER_RATE,
        minStepMs: env.MOCK_AUTO_MIN_STEP_MS,
        maxStepMs: env.MOCK_AUTO_MAX_STEP_MS,
        minTalkMs: env.MOCK_AUTO_MIN_TALK_MS,
        maxTalkMs: env.MOCK_AUTO_MAX_TALK_MS,
        logger,
      })
    : null;

  const mockVoiceProvider =
    options.voiceProvider instanceof MockVoiceProvider
      ? options.voiceProvider
      : env.VOICE_PROVIDER === "mock"
        ? new MockVoiceProvider({
            delayMs: env.MOCK_PROVIDER_DELAY_MS,
            failureRate: env.MOCK_PROVIDER_FAILURE_RATE,
            autoSimulator,
          })
        : null;

  if (
    mockVoiceProvider &&
    autoSimulator &&
    mockVoiceProvider.getAutoSimulator() !== autoSimulator
  ) {
    mockVoiceProvider.configure({ autoSimulator });
  }

  const voiceProvider: VoiceProvider =
    options.voiceProvider ??
    mockVoiceProvider ??
    new MockVoiceProvider({
      delayMs: env.MOCK_PROVIDER_DELAY_MS,
      failureRate: env.MOCK_PROVIDER_FAILURE_RATE,
      autoSimulator,
    });

  const sessionManager = new InMemorySessionManager(db, logger);
  const callCanceler = new CallCanceler(db, voiceProvider, sessionManager, logger);
  const winnerSelector = new WinnerSelector(db, sessionManager, callCanceler, logger);
  const callStatusProcessor = new CallStatusProcessor(
    db,
    sessionManager,
    winnerSelector,
    logger,
  );
  const callLaunch = new CallLaunchService(db, sessionManager, logger);

  const sessionService = new SessionService(db, sessionManager, callCanceler, logger);
  callStatusProcessor.setSessionService(sessionService);

  const activeAutoSimulator =
    voiceProvider instanceof MockVoiceProvider
      ? voiceProvider.getAutoSimulator()
      : autoSimulator;
  activeAutoSimulator?.setEmitter(async (callAttemptId, status) => {
    await callStatusProcessor.processStatus(callAttemptId, status);
  });

  const recoveryService = new RecoveryService(
    db,
    env,
    sessionManager,
    callCanceler,
    sessionService,
    logger,
  );

  const services: AppServices = {
    env,
    db,
    voiceProvider,
    mockVoiceProvider:
      voiceProvider instanceof MockVoiceProvider ? voiceProvider : mockVoiceProvider,
    sessionManager,
    callLaunch,
    callStatusProcessor,
    callCanceler,
    winnerSelector,
    sessionService,
    recoveryService,
  };

  const app = Fastify({
    loggerInstance: logger,
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return typeof header === "string" && header.length > 0
        ? header
        : cryptoRandomId();
    },
  });

  app.decorate("services", services);

  registerRequestContext(app);
  registerErrorHandler(app);
  registerServiceApiKey(app);
  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(callRoutes);
  await app.register(mockRoutes);
  await app.register(nebulaRoutes);

  if (options.runRecovery !== false) {
    app.addHook("onReady", async () => {
      await recoveryService.recover();
    });
  }

  app.addHook("onClose", async () => {
    activeAutoSimulator?.stopAll();
  });

  return app;
}

function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}
