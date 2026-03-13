import { cacheGetNumber, cacheIncrementByWindow } from "@/lib/cache/redis";
import { env } from "@/lib/env";
import { RateLimitError } from "@/lib/errors";
import { REDIS_KEYS } from "@/lib/redis/keys";

const DAILY_WINDOW_TTL_SECONDS = 172_800;

function dateKeyInNewYork(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

/**
 * Estimates token consumption with a rough character-to-token heuristic.
 *
 * @param text - Text to estimate.
 * @returns Approximate token count.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Ensures a user stays within the configured daily AI token budget.
 *
 * The quota is checked before the upstream call. The consumed amount is the
 * estimated prompt and completion budget for the request.
 *
 * @param userKey - Stable user or anonymous key.
 * @param estimatedTokens - Estimated token consumption.
 * @returns Remaining estimated tokens for the current daily window.
 */
export async function enforceDailyAITokenQuota(
  userKey: string,
  estimatedTokens: number
): Promise<number> {
  const dayKey = dateKeyInNewYork(new Date());
  const key = REDIS_KEYS.aiDailyTokens(userKey, dayKey);
  const current = await cacheGetNumber(key);
  const nextValue = current + estimatedTokens;

  if (nextValue > env.AI_DAILY_TOKEN_QUOTA) {
    throw new RateLimitError({
      userKey,
      estimatedTokens,
      quota: env.AI_DAILY_TOKEN_QUOTA,
      dayKey
    });
  }

  await cacheIncrementByWindow(key, estimatedTokens, DAILY_WINDOW_TTL_SECONDS);
  return Math.max(0, env.AI_DAILY_TOKEN_QUOTA - nextValue);
}
