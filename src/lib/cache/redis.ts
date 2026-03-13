import { createClient } from "redis";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";

const REDIS_PREFIX = "eldar:next";

type RedisClientInstance = ReturnType<typeof createClient>;
let clientPromise: Promise<RedisClientInstance | null> | null = null;
let hardDisabledReason: string | null = null;
const recentOperationWarnings = new Map<string, number>();
const OPERATION_WARNING_TTL_MS = 60_000;

function warnOperation(operation: string, key: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown Redis operation error";
  const signature = `${operation}:${key}:${message}`;
  const now = Date.now();
  const previous = recentOperationWarnings.get(signature) ?? 0;
  if (now - previous < OPERATION_WARNING_TTL_MS) {
    return;
  }
  recentOperationWarnings.set(signature, now);
  log({
    level: "warn",
    service: "redis",
    message: "Redis operation failed",
    operation,
    key: keyName(key),
    error: message
  });
}

function redisEnabledByConfig(): boolean {
  return env.USE_REDIS;
}

function redisUrl(): string {
  return env.REDIS_URL;
}

async function getClient(): Promise<RedisClientInstance | null> {
  if (!redisEnabledByConfig()) return null;
  if (hardDisabledReason) return null;

  const url = redisUrl();
  if (!url) {
    hardDisabledReason = "REDIS_URL is missing while USE_REDIS=true";
    log({
      level: "warn",
      service: "redis",
      message: "Redis unavailable; falling back to no-cache mode",
      reason: hardDisabledReason
    });
    return null;
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const client = createClient({ url });
        client.on("error", (error) => {
          const message = error instanceof Error ? error.message : "Unknown Redis error";
          log({
            level: "error",
            service: "redis",
            message: "Redis client error",
            error: message
          });
        });
        await client.connect();
        await client.ping();
        log({
          level: "info",
          service: "redis",
          message: "Redis connected"
        });
        return client;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Redis bootstrap error";
        hardDisabledReason = message;
        log({
          level: "warn",
          service: "redis",
          message: "Redis unavailable; falling back to no-cache mode",
          error: message
        });
        clientPromise = null;
        return null;
      }
    })();
  }

  return clientPromise;
}

function keyName(key: string): string {
  return `${REDIS_PREFIX}:${key}`;
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const client = await getClient();
  if (!client) return null;

  try {
    const raw = await client.get(keyName(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    warnOperation("get", key, error);
    return null;
  }
}

export async function cacheGetString(key: string): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;

  try {
    const raw = await client.get(keyName(key));
    return raw ?? null;
  } catch (error) {
    warnOperation("get", key, error);
    return null;
  }
}

export async function cacheGetNumber(key: string): Promise<number> {
  const raw = await cacheGetString(key);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.set(keyName(key), JSON.stringify(value), {
      EX: Math.max(1, Math.floor(ttlSeconds))
    });
  } catch (error) {
    warnOperation("set", key, error);
  }
}

export async function cacheSetString(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.set(keyName(key), value, {
      EX: Math.max(1, Math.floor(ttlSeconds))
    });
  } catch (error) {
    warnOperation("set", key, error);
  }
}

export async function cacheDelete(key: string): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.del(keyName(key));
  } catch (error) {
    warnOperation("del", key, error);
  }
}

export async function cacheDeleteMany(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const client = await getClient();
  if (!client) return 0;

  const redisKeys = keys.map((key) => keyName(key));
  try {
    return await client.del(redisKeys);
  } catch (error) {
    warnOperation("del-many", keys[0] ?? "unknown", error);
    return 0;
  }
}

export async function cacheDeleteByPrefix(prefix: string): Promise<number> {
  const client = await getClient();
  if (!client) return 0;

  const matchPattern = keyName(`${prefix}*`);
  const toDelete: string[] = [];
  try {
    for await (const key of client.scanIterator({ MATCH: matchPattern, COUNT: 200 })) {
      toDelete.push(String(key));
    }
    if (toDelete.length === 0) return 0;
    return await client.del(toDelete);
  } catch (error) {
    warnOperation("del-prefix", prefix, error);
    return 0;
  }
}

export function redisCacheMode(): "disabled" | "enabled" {
  return redisEnabledByConfig() && !hardDisabledReason ? "enabled" : "disabled";
}

export async function cacheSetIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;

  try {
    const result = await client.set(keyName(key), value, {
      NX: true,
      PX: Math.max(1, Math.floor(ttlMs))
    });
    return result === "OK";
  } catch (error) {
    warnOperation("set-nx", key, error);
    return false;
  }
}

export async function cacheDeleteIfEquals(key: string, expectedValue: string): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;

  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;

  try {
    const result = await client.eval(script, {
      keys: [keyName(key)],
      arguments: [expectedValue]
    });
    return Number(result) > 0;
  } catch (error) {
    warnOperation("del-if-eq", key, error);
    return false;
  }
}

export async function cacheIncrementWindow(key: string, ttlSeconds: number): Promise<number | null> {
  const client = await getClient();
  if (!client) return null;

  try {
    const redisKey = keyName(key);
    const value = await client.incr(redisKey);
    if (value === 1) {
      await client.expire(redisKey, Math.max(1, Math.floor(ttlSeconds)));
    }
    return value;
  } catch (error) {
    warnOperation("incr", key, error);
    return null;
  }
}

export async function cacheIncrementByWindow(
  key: string,
  amount: number,
  ttlSeconds: number
): Promise<number | null> {
  const client = await getClient();
  if (!client) return null;

  try {
    const redisKey = keyName(key);
    const value = await client.incrBy(redisKey, Math.floor(amount));
    if (value === amount) {
      await client.expire(redisKey, Math.max(1, Math.floor(ttlSeconds)));
    }
    return value;
  } catch (error) {
    warnOperation("incrby", key, error);
    return null;
  }
}
