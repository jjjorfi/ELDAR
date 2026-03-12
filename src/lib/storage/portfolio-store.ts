import { sql } from "@vercel/postgres";

import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import type { PersistedPortfolioSnapshot, PortfolioRating, PortfolioSnapshotHolding } from "@/lib/scoring/portfolio/types";
import {
  ensurePortfolioStore,
  hasPostgres,
  makeId,
  portfolioRedisKey,
  readLocal,
  writeLocal
} from "@/lib/storage/shared";

export async function savePortfolioSnapshot(input: {
  userId: string;
  portfolioId: string;
  asOfDate: string;
  holdings: PortfolioSnapshotHolding[];
  rating: PortfolioRating;
}): Promise<PersistedPortfolioSnapshot> {
  const persisted: PersistedPortfolioSnapshot = {
    id: makeId(),
    userId: input.userId,
    portfolioId: input.portfolioId,
    asOfDate: input.asOfDate,
    holdings: input.holdings,
    rating: input.rating,
    createdAt: new Date().toISOString()
  };

  if (hasPostgres) {
    await ensurePortfolioStore();
    await sql`
      INSERT INTO portfolio_snapshots (id, user_id, portfolio_id, payload)
      VALUES (${persisted.id}, ${persisted.userId}, ${persisted.portfolioId}, ${JSON.stringify(persisted)}::jsonb)
    `;
    await cacheSetJson(portfolioRedisKey(persisted.userId, persisted.portfolioId), persisted, 60 * 30);
    return persisted;
  }

  const db = await readLocal();
  db.portfolioSnapshots.unshift(persisted);
  db.portfolioSnapshots = db.portfolioSnapshots.slice(0, 1500);
  await writeLocal(db);
  await cacheSetJson(portfolioRedisKey(persisted.userId, persisted.portfolioId), persisted, 60 * 30);
  return persisted;
}

export async function getLatestPortfolioSnapshot(
  userId: string,
  portfolioId = "default"
): Promise<PersistedPortfolioSnapshot | null> {
  const redisKey = portfolioRedisKey(userId, portfolioId);
  const redisCached = await cacheGetJson<PersistedPortfolioSnapshot>(redisKey);
  if (redisCached) {
    return redisCached;
  }

  if (hasPostgres) {
    await ensurePortfolioStore();
    const { rows } = await sql<{ payload: PersistedPortfolioSnapshot }>`
      SELECT payload
      FROM portfolio_snapshots
      WHERE user_id = ${userId}
        AND portfolio_id = ${portfolioId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const snapshot = rows[0].payload;
    await cacheSetJson(redisKey, snapshot, 60 * 30);
    return snapshot;
  }

  const db = await readLocal();
  const latest = db.portfolioSnapshots.find((item) => item.userId === userId && item.portfolioId === portfolioId) ?? null;
  if (latest) {
    await cacheSetJson(redisKey, latest, 60 * 30);
  }
  return latest;
}
