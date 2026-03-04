import { createClient } from "redis";

const REDIS_PREFIX = "eldar:next";

type RedisClientInstance = ReturnType<typeof createClient>;
let clientPromise: Promise<RedisClientInstance | null> | null = null;
let hardDisabledReason: string | null = null;

function redisEnabledByConfig(): boolean {
  return String(process.env.USE_REDIS ?? "").trim().toLowerCase() === "true";
}

function redisUrl(): string {
  return String(process.env.REDIS_URL ?? "").trim();
}

async function getClient(): Promise<RedisClientInstance | null> {
  if (!redisEnabledByConfig()) return null;
  if (hardDisabledReason) return null;

  const url = redisUrl();
  if (!url) {
    hardDisabledReason = "REDIS_URL is missing while USE_REDIS=true";
    console.warn(`[Redis Cache]: ${hardDisabledReason}. Falling back to no-cache mode.`);
    return null;
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const client = createClient({ url });
        client.on("error", (error) => {
          const message = error instanceof Error ? error.message : "Unknown Redis error";
          console.error(`[Redis Cache]: client error: ${message}`);
        });
        await client.connect();
        await client.ping();
        console.log("[Redis Cache]: connected.");
        return client;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Redis bootstrap error";
        hardDisabledReason = message;
        console.warn(`[Redis Cache]: unavailable (${message}). Falling back to no-cache mode.`);
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
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.set(keyName(key), JSON.stringify(value), {
      EX: Math.max(1, Math.floor(ttlSeconds))
    });
  } catch {
    // keep API path non-blocking when cache fails
  }
}

export async function cacheDelete(key: string): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.del(keyName(key));
  } catch {
    // no-op
  }
}

export function redisCacheMode(): "disabled" | "enabled" {
  return redisEnabledByConfig() && !hardDisabledReason ? "enabled" : "disabled";
}
