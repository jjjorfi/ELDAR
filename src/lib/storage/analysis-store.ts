import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import type { AnalysisResult, PersistedAnalysis } from "@/lib/types";

import {
  analysisRedisKey,
  ensureAnalysesStore,
  getCacheWindowMinutes,
  hasPostgres,
  makeId,
  normalizePersistedAnalysis,
  readLocal,
  shouldRefreshCachedAnalysis,
  writeLocal
} from "@/lib/storage/shared";
import { sql } from "@vercel/postgres";

export async function saveAnalysis(result: AnalysisResult, userId: string | null = null): Promise<PersistedAnalysis> {
  const persisted: PersistedAnalysis = {
    ...result,
    id: makeId(),
    createdAt: new Date().toISOString()
  };

  if (hasPostgres) {
    await ensureAnalysesStore();

    await sql`
      INSERT INTO analyses (id, user_id, symbol, company_name, score, rating, payload)
      VALUES (${persisted.id}, ${userId}, ${persisted.symbol}, ${persisted.companyName}, ${persisted.score}, ${persisted.rating}, ${JSON.stringify(persisted)}::jsonb)
    `;

    await cacheSetJson(analysisRedisKey(persisted.symbol, userId), persisted, getCacheWindowMinutes() * 60);
    return persisted;
  }

  const db = await readLocal();
  db.analyses.unshift({ userId, analysis: persisted });
  db.analyses = db.analyses.slice(0, 3000);
  await writeLocal(db);
  await cacheSetJson(analysisRedisKey(persisted.symbol, userId), persisted, getCacheWindowMinutes() * 60);
  return persisted;
}

export async function getRecentAnalyses(limit = 20, userId: string | null = null): Promise<PersistedAnalysis[]> {
  if (hasPostgres) {
    await ensureAnalysesStore();

    const { rows } = await sql<{ payload: PersistedAnalysis }>`
      SELECT payload
      FROM analyses
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows
      .map((row) => normalizePersistedAnalysis(row.payload))
      .filter((analysis) => !shouldRefreshCachedAnalysis(analysis))
      .slice(0, limit);
  }

  const db = await readLocal();
  return db.analyses
    .filter((row) => row.userId === userId)
    .map((row) => row.analysis)
    .filter((analysis) => !shouldRefreshCachedAnalysis(analysis))
    .slice(0, limit);
}

export async function getCachedAnalysis(
  symbol: string,
  minutes = getCacheWindowMinutes(),
  userId: string | null = null
): Promise<PersistedAnalysis | null> {
  const normalized = symbol.toUpperCase();
  const redisKey = analysisRedisKey(normalized, userId);
  const redisCached = await cacheGetJson<PersistedAnalysis>(redisKey);
  if (redisCached) {
    const ageMs = Date.now() - new Date(redisCached.createdAt).getTime();
    const withinWindow = Number.isFinite(ageMs) && ageMs <= minutes * 60 * 1000;
    if (withinWindow && !shouldRefreshCachedAnalysis(redisCached)) {
      return redisCached;
    }
  }

  if (hasPostgres) {
    await ensureAnalysesStore();

    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const { rows } = await sql<{ payload: PersistedAnalysis }>`
      SELECT payload
      FROM analyses
      WHERE symbol = ${normalized}
        AND (${userId}::text IS NOT NULL AND user_id = ${userId} OR ${userId}::text IS NULL AND user_id IS NULL)
        AND created_at >= ${cutoff}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) return null;
    const parsed = normalizePersistedAnalysis(rows[0].payload);
    if (shouldRefreshCachedAnalysis(parsed)) return null;
    await cacheSetJson(redisKey, parsed, minutes * 60);
    return parsed;
  }

  const db = await readLocal();
  const cached = db.analyses.find(
    (item) =>
      item.analysis.symbol === normalized &&
      (userId === null || item.userId === userId || item.userId === null) &&
      Date.now() - new Date(item.analysis.createdAt).getTime() <= minutes * 60 * 1000
  );

  if (!cached || shouldRefreshCachedAnalysis(cached.analysis)) {
    return null;
  }

  await cacheSetJson(redisKey, cached.analysis, minutes * 60);
  return cached.analysis;
}

export async function getLastKnownPrice(symbol: string): Promise<number | null> {
  const normalized = symbol.toUpperCase();

  if (hasPostgres) {
    await ensureAnalysesStore();

    const { rows } = await sql<{ payload: PersistedAnalysis }>`
      SELECT payload
      FROM analyses
      WHERE symbol = ${normalized}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) return null;
    const parsed = normalizePersistedAnalysis(rows[0].payload);
    return typeof parsed.currentPrice === "number" && Number.isFinite(parsed.currentPrice) && parsed.currentPrice > 0
      ? parsed.currentPrice
      : null;
  }

  const db = await readLocal();
  const latest = db.analyses.find((item) => item.analysis.symbol === normalized)?.analysis;
  if (!latest) return null;

  return typeof latest.currentPrice === "number" && Number.isFinite(latest.currentPrice) && latest.currentPrice > 0
    ? latest.currentPrice
    : null;
}
