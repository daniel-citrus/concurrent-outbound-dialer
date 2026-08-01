import type { Env } from "../config/env.js";
import type { DbPool } from "../database/pool.js";
import type { VoiceProvider } from "../providers/voice-provider.js";
import type { MockVoiceProvider } from "../providers/mock-voice-provider.js";
import type { SessionManager } from "../controllers/session-manager.js";
import type { CallStatusProcessor } from "../services/call-status-processor.js";
import type { CallCanceler } from "../services/call-canceler.js";
import type { WinnerSelector } from "../services/winner-selector.js";
import type { SessionService } from "../services/session-service.js";
import type { RecoveryService } from "../services/recovery-service.js";
import type { CallLaunchService } from "../services/call-launch.js";

export type AppServices = {
  env: Env;
  db: DbPool;
  voiceProvider: VoiceProvider;
  mockVoiceProvider: MockVoiceProvider | null;
  sessionManager: SessionManager;
  callLaunch: CallLaunchService;
  callStatusProcessor: CallStatusProcessor;
  callCanceler: CallCanceler;
  winnerSelector: WinnerSelector;
  sessionService: SessionService;
  recoveryService: RecoveryService;
};
