// AI CONTEXT TRACE:
// File Purpose:
// - Implements pluggable state storage for realtime throttling/state (Adapter Pattern).
// - Provides real Redis-backed state when enabled, with automatic fallback to in-memory.
//
// Integration Points:
// - /Users/s.bahij/Documents/ELDAR SaaS/realtime-server/server.js
// - Config source: /Users/s.bahij/Documents/ELDAR SaaS/realtime-server/config/shared-config.js
//
// Gotchas:
// - Redis mode is opt-in via USE_REDIS=true + REDIS_URL.
// - If Redis is misconfigured/down, startup falls back to memory (fail-open by design for availability).

const { createClient } = require("redis");

const REDIS_KEY_PREFIX = "eldar:realtime:state:";
const REDIS_ENTRY_TTL_SECONDS = 300;

class InMemoryStateAdapter {
  constructor() {
    this.store = new Map();
    this.mode = "memory";
  }

  async init() {
    return;
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async set(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async size() {
    return this.store.size;
  }

  async entries() {
    return Array.from(this.store.entries());
  }

  async shutdown() {
    return;
  }
}

class RedisStateAdapter {
  constructor(redisUrl) {
    this.mode = "redis";
    this.redisUrl = redisUrl;
    this.client = createClient({ url: redisUrl });
    this.isReady = false;
  }

  keyName(key) {
    return `${REDIS_KEY_PREFIX}${key}`;
  }

  async init() {
    this.client.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Unknown Redis client error.";
      console.error(`[Socket Server][Redis Adapter]: Client error: ${message}`);
    });

    await this.client.connect();
    await this.client.ping();
    this.isReady = true;
    console.log("[Socket Server][Redis Adapter]: Connected and ready.");
  }

  ensureReady() {
    if (!this.isReady) {
      throw new Error("Redis adapter used before init() completion.");
    }
  }

  async get(key) {
    this.ensureReady();
    const raw = await this.client.get(this.keyName(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key, value) {
    this.ensureReady();
    await this.client.set(this.keyName(key), JSON.stringify(value), {
      EX: REDIS_ENTRY_TTL_SECONDS
    });
  }

  async delete(key) {
    this.ensureReady();
    await this.client.del(this.keyName(key));
  }

  async size() {
    this.ensureReady();
    const keys = await this.client.keys(`${REDIS_KEY_PREFIX}*`);
    return keys.length;
  }

  async entries() {
    this.ensureReady();
    const keys = await this.client.keys(`${REDIS_KEY_PREFIX}*`);
    if (keys.length === 0) return [];

    const values = await this.client.mGet(keys);
    const out = [];
    for (let index = 0; index < keys.length; index += 1) {
      const raw = values[index];
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const key = keys[index].replace(REDIS_KEY_PREFIX, "");
        out.push([key, parsed]);
      } catch {
        continue;
      }
    }
    return out;
  }

  async shutdown() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
    this.isReady = false;
  }
}

async function createStateAdapter(config) {
  if (!config.useRedis) {
    return new InMemoryStateAdapter();
  }

  if (!config.redisUrl) {
    console.warn(
      "[Socket Server]: USE_REDIS=true but REDIS_URL is empty. Falling back to in-memory adapter."
    );
    return new InMemoryStateAdapter();
  }

  try {
    const redisAdapter = new RedisStateAdapter(config.redisUrl);
    await redisAdapter.init();
    return redisAdapter;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis bootstrap error.";
    console.error(
      `[Socket Server]: Redis adapter failed to initialize (${message}). Falling back to in-memory adapter.`
    );
    return new InMemoryStateAdapter();
  }
}

module.exports = {
  createStateAdapter
};
