import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { MOCK_AUTO_SIMULATE_DEFAULTS } from "../providers/mock-call-auto-simulator.js";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Optional: only for `npm run db:migrate` against Postgres directly. */
  DATABASE_URL: z.string().optional().default(""),
  /** Preferred Supabase project URL for runtime (service role). */
  SUPABASE_URL: z.union([z.string().url(), z.literal("")]).optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  /** Alias / legacy Nebula import credentials — used as fallback for runtime DB. */
  NEBULA_SUPABASE_URL: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .default(""),
  NEBULA_SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  VOICE_PROVIDER: z.enum(["mock"]).default("mock"),
  MOCK_PROVIDER_DELAY_MS: z.coerce.number().int().nonnegative().default(50),
  MOCK_PROVIDER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
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
});

export type Env = z.infer<typeof envSchema>;

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

/** Resolve Supabase URL + service role for the dialer runtime. */
export function resolveSupabaseCredentials(env: Env): {
  url: string;
  serviceRoleKey: string;
} {
  const url = (env.SUPABASE_URL || env.NEBULA_SUPABASE_URL || "").trim();
  const serviceRoleKey = (
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.NEBULA_SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase credentials required: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY " +
        "(or NEBULA_SUPABASE_URL + NEBULA_SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return { url, serviceRoleKey };
}
