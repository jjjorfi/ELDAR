import { createHash } from "node:crypto";

import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { env } from "@/lib/env";
import { REDIS_KEYS } from "@/lib/redis/keys";

const memoryCache = new Map<string, { expiresAt: number; value: string }>();

export type AICacheOptions = {
  scope: string;
  model: string;
  prompt: string;
};

function cacheKey(options: AICacheOptions): string {
  const promptHash = createHash("sha256").update(options.prompt).digest("hex");
  return REDIS_KEYS.aiCache(options.scope, options.model, promptHash);
}

/**
 * Reads a cached AI response from memory first, then Redis.
 *
 * @param options - Cache identity parameters.
 * @returns Cached assistant content when available.
 */
export async function getCachedAIResponse(options: AICacheOptions): Promise<string | null> {
  const key = cacheKey(options);
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (cached) {
    memoryCache.delete(key);
  }

  const redisValue = await cacheGetJson<{ content: string }>(key);
  if (!redisValue?.content) {
    return null;
  }

  memoryCache.set(key, {
    expiresAt: Date.now() + env.AI_CACHE_TTL_SECONDS * 1_000,
    value: redisValue.content
  });

  return redisValue.content;
}

/**
 * Stores an AI response in memory and Redis.
 *
 * @param options - Cache identity parameters.
 * @param content - Assistant content to store.
 */
export async function setCachedAIResponse(options: AICacheOptions, content: string): Promise<void> {
  const key = cacheKey(options);
  memoryCache.set(key, {
    expiresAt: Date.now() + env.AI_CACHE_TTL_SECONDS * 1_000,
    value: content
  });

  await cacheSetJson(key, { content }, env.AI_CACHE_TTL_SECONDS);
}
