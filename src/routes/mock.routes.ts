import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validationError } from "../domain/errors.js";
import type { MockCallAutoSimulatorConfig } from "../providers/mock-call-auto-simulator.js";
import { MOCK_AUTO_SIMULATE_DEFAULTS } from "../providers/mock-call-auto-simulator.js";

const nonNegInt = z.coerce.number().int().nonnegative();
const nonNegNumber = z.coerce.number().nonnegative();

const configSchema = z.object({
  answerRate: z.coerce.number().min(0).max(1).optional(),
  minStepMs: nonNegInt.optional(),
  maxStepMs: nonNegInt.optional(),
  minTalkMs: nonNegInt.optional(),
  maxTalkMs: nonNegInt.optional(),
  busyWeight: nonNegNumber.optional(),
  failedWeight: nonNegNumber.optional(),
  noAnswerWeight: nonNegNumber.optional(),
});

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** When true, restore factory defaults (MOCK_AUTO_SIMULATE_DEFAULTS). */
    reset: z.boolean().optional(),
  })
  .merge(configSchema)
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export type MockAutoSimulateState = {
  available: boolean;
  enabled: boolean;
  config: MockCallAutoSimulatorConfig;
  defaults: MockCallAutoSimulatorConfig;
};

function withDefaults(
  partial: Omit<MockAutoSimulateState, "defaults">,
): MockAutoSimulateState {
  return {
    ...partial,
    defaults: { ...MOCK_AUTO_SIMULATE_DEFAULTS },
  };
}

function unavailableState(): MockAutoSimulateState {
  return withDefaults({
    available: false,
    enabled: false,
    config: { ...MOCK_AUTO_SIMULATE_DEFAULTS },
  });
}

export const mockRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mock/auto-simulate", async () => {
    const simulator = app.services.mockVoiceProvider?.getAutoSimulator() ?? null;
    if (!simulator) {
      return unavailableState();
    }
    return withDefaults({
      available: true,
      enabled: simulator.isEnabled(),
      config: simulator.getConfig(),
    });
  });

  app.patch("/mock/auto-simulate", async (request) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationError(
        "Body may include enabled, reset, answerRate, min/maxStepMs, min/maxTalkMs, and outcome weights",
      );
    }

    const simulator = app.services.mockVoiceProvider?.getAutoSimulator() ?? null;
    if (!simulator) {
      return unavailableState();
    }

    const { enabled, reset, ...configPatch } = parsed.data;
    if (enabled !== undefined) {
      simulator.setEnabled(enabled);
    }
    if (reset) {
      simulator.configure({ ...MOCK_AUTO_SIMULATE_DEFAULTS });
    } else if (Object.keys(configPatch).length > 0) {
      simulator.configure(configPatch);
    }

    return withDefaults({
      available: true,
      enabled: simulator.isEnabled(),
      config: simulator.getConfig(),
    });
  });
};
