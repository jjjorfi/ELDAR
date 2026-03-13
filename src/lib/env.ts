import { z } from "zod";

const OPTIONAL_URL_MESSAGE = "Expected a valid URL when configured.";

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const OptionalUrlSchema = z
  .string()
  .trim()
  .default("")
  .refine((value) => value.length === 0 || isValidUrl(value), OPTIONAL_URL_MESSAGE);

const BooleanEnvSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

function positiveIntEnv(defaultValue: number): z.ZodEffects<z.ZodTypeAny, number, unknown> {
  return z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    if (normalized.length === 0) {
      return defaultValue;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }, z.number().int().positive());
}

/**
 * Validates process environment for shared backend infrastructure.
 *
 * Fields are intentionally permissive where the current application supports
 * optional local fallbacks. Invalid configured values still fail fast.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL: z.string().trim().default(""),
  CRON_SECRET: z.string().trim().default(""),
  JWT_SECRET: z.string().trim().default(""),
  REALTIME_PUBLISH_SECRET: z.string().trim().default(""),
  REDIS_URL: OptionalUrlSchema,
  POSTGRES_URL: OptionalUrlSchema,
  LOCAL_DB_PATH: z.string().trim().default(""),
  LOCAL_JOURNAL_DB_PATH: z.string().trim().default(""),
  NEXT_PUBLIC_SITE_URL: OptionalUrlSchema,
  NEXT_PUBLIC_REALTIME_URL: OptionalUrlSchema,
  REALTIME_SERVER_INTERNAL_URL: OptionalUrlSchema,
  USE_REDIS: BooleanEnvSchema.default(false),
  RATE_LIMIT_RPM: positiveIntEnv(60),
  MAX_BODY_BYTES: positiveIntEnv(64 * 1024),
  ANALYSIS_CACHE_MINUTES: positiveIntEnv(15),
  HF_API_KEY: z.string().trim().default(""),
  HF_BASE_URL: OptionalUrlSchema.default("https://router.huggingface.co/v1"),
  HF_MODEL_SMALL: z.string().trim().default("Qwen/Qwen2.5-1.5B-Instruct"),
  HF_MODEL_LARGE: z.string().trim().default("Qwen/Qwen2.5-7B-Instruct"),
  AI_DAILY_TOKEN_QUOTA: positiveIntEnv(100_000),
  AI_CACHE_TTL_SECONDS: positiveIntEnv(86_400),
  BOT_WAF_HEADER: z.string().trim().default(""),
  FINNHUB_API_KEY: z.string().trim().default(""),
  FMP_API_KEY: z.string().trim().default(""),
  FRED_API_KEY: z.string().trim().default(""),
  ALPHA_VANTAGE_API_KEY: z.string().trim().default(""),
  MASSIVE_API_KEY: z.string().trim().default(""),
  EODHD_API_KEY: z.string().trim().default(""),
  ALPACA_API_KEY: z.string().trim().default(""),
  ALPACA_API_KEY_ID: z.string().trim().default(""),
  APCA_API_KEY_ID: z.string().trim().default(""),
  ALPACA_API_SECRET: z.string().trim().default(""),
  ALPACA_SECRET_KEY: z.string().trim().default(""),
  APCA_API_SECRET_KEY: z.string().trim().default(""),
  REALTIME_HOST: z.string().trim().default("0.0.0.0"),
  REALTIME_PORT: positiveIntEnv(4100),
  REALTIME_MAX_UPDATES_PER_SECOND: positiveIntEnv(10),
  REALTIME_HEARTBEAT_INTERVAL_MS: positiveIntEnv(15_000),
  REALTIME_HEARTBEAT_TIMEOUT_MS: positiveIntEnv(45_000),
  REALTIME_ALPACA_STREAM: BooleanEnvSchema.default(true),
  REALTIME_ALPACA_STREAM_URL: z.string().trim().default("wss://stream.data.alpaca.markets/v2/iex"),
  REALTIME_QUOTE_FLUSH_MS: positiveIntEnv(250),
  REALTIME_QUOTE_RECONNECT_MS: positiveIntEnv(5_000),
  SNAPSHOT_LOCK_TTL_MS: positiveIntEnv(90_000),
  SNAPSHOT_MARKET_BUDGET_PER_MIN: positiveIntEnv(1_800),
  SNAPSHOT_SEC_BUDGET_PER_MIN: positiveIntEnv(360),
  SNAPSHOT_NEWS_TIMEOUT_MS: positiveIntEnv(1_500),
  REALTIME_STREAM_SYMBOLS: z.string().trim().default(""),
  CORS_ORIGIN: z.string().trim().default(""),
  ELDAR_DEBUG_SECTOR: BooleanEnvSchema.default(false)
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Re-validates the current process environment on demand.
 */
export function getEnv(): Env {
  return EnvSchema.parse(process.env);
}

/**
 * Shared validated environment accessor for backend modules.
 *
 * A proxy is used so tests and local tooling that mutate `process.env` after
 * module evaluation still see current validated values.
 */
export const env = new Proxy({} as Env, {
  get(_target, property: keyof Env | symbol): Env[keyof Env] | undefined {
    if (typeof property === "symbol") {
      return undefined;
    }

    return getEnv()[property];
  }
});
