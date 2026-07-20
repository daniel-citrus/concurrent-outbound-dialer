import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { MOCK_AUTO_SIMULATE_DEFAULTS } from "../providers/mock-call-auto-simulator.js";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  VOICE_PROVIDER: z.enum(["mock"]).default("mock"),
  MOCK_PROVIDER_DELAY_MS: z.coerce.number().int().nonnegative().default(50),
  MOCK_PROVIDER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  /** When true, mock provider auto-emits random call statuses (no simulate clicks). */
  MOCK_AUTO_SIMULATE: envBoolean(false),
  MOCK_AUTO_ANSWER_RATE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(MOCK_AUTO_SIMULATE_DEFAULTS.answerRate),
  MOCK_AUTO_MIN_STEP_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(MOCK_AUTO_SIMULATE_DEFAULTS.minStepMs),
  MOCK_AUTO_MAX_STEP_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(MOCK_AUTO_SIMULATE_DEFAULTS.maxStepMs),
  MOCK_AUTO_MIN_TALK_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(MOCK_AUTO_SIMULATE_DEFAULTS.minTalkMs),
  MOCK_AUTO_MAX_TALK_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(MOCK_AUTO_SIMULATE_DEFAULTS.maxTalkMs),
  SERVICE_API_KEY: z.string().optional().default(""),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CREATING_ATTEMPT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  NEBULA_SUPABASE_URL: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .default(""),
  NEBULA_SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

/** Parse common truthy/falsey env string forms; empty/missing → defaultValue. */
function envBoolean(defaultValue: boolean) {
  return z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return defaultValue;
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0;
    if (typeof val === "string") {
      const normalized = val.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    return defaultValue;
  }, z.boolean());
}

let cached: Env | undefined;

export function loadEnv(overrides?: Record<string, string | undefined>): Env {
  if (cached && !overrides) {
    return cached;
  }
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  if (!overrides) {
    cached = parsed.data;
  }
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = undefined;
}
