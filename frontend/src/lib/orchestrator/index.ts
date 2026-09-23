import { createMockCallPlacer } from "./call-placer";
import { ClientMockAutoSimulator } from "./client-mock-auto-simulator";
import { ClientSessionOrchestrator } from "./client-session-orchestrator";

export type ClientOrchestratorBundle = {
  orchestrator: ClientSessionOrchestrator;
  autoSimulator: ClientMockAutoSimulator;
};

export function createClientOrchestrator(onChange?: () => void): ClientOrchestratorBundle {
  const autoSimulator = new ClientMockAutoSimulator();
  const orchestrator = new ClientSessionOrchestrator({
    callPlacer: createMockCallPlacer(),
    autoSimulator,
    onChange,
  });
  autoSimulator.setEmitter((callAttemptId, status) =>
    orchestrator.reportStatus(callAttemptId, status),
  );
  return { orchestrator, autoSimulator };
}

export { ClientSessionOrchestrator } from "./client-session-orchestrator";
export { ClientMockAutoSimulator, CLIENT_MOCK_AUTO_SIMULATE_DEFAULTS } from "./client-mock-auto-simulator";
export { createMockCallPlacer } from "./call-placer";
export type { CallPlacer, ReservedClaim } from "./call-placer";
