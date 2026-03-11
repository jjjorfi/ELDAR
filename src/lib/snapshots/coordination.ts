import crypto from "node:crypto";

import {
  cacheDeleteIfEquals,
  cacheIncrementWindow,
  cacheSetIfAbsent,
  redisCacheMode
} from "@/lib/cache/redis";

const LOCK_KEY_PREFIX = "snapshots:lock";
const BUDGET_KEY_PREFIX = "snapshots:budget";

const localLocks = new Map<string, { token: string; expiresAt: number }>();
const localBudgetCounters = new Map<string, { count: number; expiresAt: number }>();

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function lockKey(symbol: string): string {
  return `${LOCK_KEY_PREFIX}:${normalizeSymbol(symbol)}`;
}

function budgetKey(provider: string): string {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  return `${BUDGET_KEY_PREFIX}:${provider}:${minuteBucket}`;
}

function cleanupLocalLocks(nowMs: number): void {
  for (const [key, value] of localLocks.entries()) {
    if (value.expiresAt <= nowMs) {
      localLocks.delete(key);
    }
  }
}

function cleanupLocalBudgets(nowMs: number): void {
  for (const [key, value] of localBudgetCounters.entries()) {
    if (value.expiresAt <= nowMs) {
      localBudgetCounters.delete(key);
    }
  }
}

export interface LockHandle {
  acquired: boolean;
  token: string;
}

export async function acquireTickerBuildLock(symbol: string, ttlMs = 90_000): Promise<LockHandle> {
  const token = crypto.randomUUID();
  const key = lockKey(symbol);
  const redisEnabled = redisCacheMode() === "enabled";

  if (redisEnabled) {
    const acquired = await cacheSetIfAbsent(key, token, ttlMs);
    return { acquired, token };
  }

  const nowMs = Date.now();
  cleanupLocalLocks(nowMs);
  const existing = localLocks.get(key);
  if (existing && existing.expiresAt > nowMs) {
    return { acquired: false, token };
  }
  localLocks.set(key, {
    token,
    expiresAt: nowMs + Math.max(1, ttlMs)
  });
  return { acquired: true, token };
}

export async function releaseTickerBuildLock(symbol: string, token: string): Promise<void> {
  const key = lockKey(symbol);
  const redisEnabled = redisCacheMode() === "enabled";

  if (redisEnabled) {
    await cacheDeleteIfEquals(key, token);
    return;
  }

  const existing = localLocks.get(key);
  if (!existing) return;
  if (existing.token === token) {
    localLocks.delete(key);
  }
}

export async function consumeProviderBudget(
  provider: string,
  maxPerMinute: number
): Promise<{ allowed: boolean; used: number | null }> {
  const safeLimit = Math.max(1, Math.floor(maxPerMinute));
  const key = budgetKey(provider);
  const redisEnabled = redisCacheMode() === "enabled";

  if (redisEnabled) {
    const used = await cacheIncrementWindow(key, 60);
    if (used === null) {
      return { allowed: true, used: null };
    }
    return { allowed: used <= safeLimit, used };
  }

  const nowMs = Date.now();
  cleanupLocalBudgets(nowMs);
  const existing = localBudgetCounters.get(key);
  if (!existing) {
    localBudgetCounters.set(key, {
      count: 1,
      expiresAt: nowMs + 60_000
    });
    return { allowed: true, used: 1 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= safeLimit,
    used: existing.count
  };
}

