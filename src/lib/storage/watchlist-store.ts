import { sql } from "@vercel/postgres";

import type { PersistedAnalysis, WatchlistItem } from "@/lib/types";
import {
  ensureWatchlistStore,
  hasPostgres,
  normalizePersistedAnalysis,
  readLocal,
  writeLocal
} from "@/lib/storage/shared";

export async function addToWatchlist(symbol: string, userId: string): Promise<void> {
  const normalized = symbol.toUpperCase();

  if (hasPostgres) {
    await ensureWatchlistStore();
    await sql`
      INSERT INTO watchlist (user_id, symbol)
      VALUES (${userId}, ${normalized})
      ON CONFLICT (user_id, symbol) DO NOTHING
    `;
    return;
  }

  const db = await readLocal();
  if (!db.watchlist.some((item) => item.symbol === normalized && item.userId === userId)) {
    db.watchlist.unshift({
      userId,
      symbol: normalized,
      createdAt: new Date().toISOString()
    });
    db.watchlist = db.watchlist.slice(0, 100);
    await writeLocal(db);
  }
}

export async function removeFromWatchlist(symbol: string, userId: string): Promise<void> {
  const normalized = symbol.toUpperCase();

  if (hasPostgres) {
    await ensureWatchlistStore();
    await sql`DELETE FROM watchlist WHERE symbol = ${normalized} AND user_id = ${userId}`;
    return;
  }

  const db = await readLocal();
  db.watchlist = db.watchlist.filter((item) => !(item.symbol === normalized && item.userId === userId));
  await writeLocal(db);
}

export async function getWatchlist(userId: string): Promise<WatchlistItem[]> {
  if (hasPostgres) {
    await ensureWatchlistStore();

    const { rows } = await sql<{
      symbol: string;
      created_at: string;
      payload: PersistedAnalysis | null;
    }>`
      SELECT w.symbol, w.created_at, latest.payload
      FROM watchlist w
      LEFT JOIN LATERAL (
        SELECT payload
        FROM analyses a
        WHERE a.symbol = w.symbol
          AND (a.user_id = ${userId} OR a.user_id IS NULL)
        ORDER BY a.created_at DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE w.user_id = ${userId}
      ORDER BY w.created_at DESC
    `;

    return rows.map((row) => ({
      symbol: row.symbol,
      createdAt: new Date(row.created_at).toISOString(),
      latest: row.payload ? normalizePersistedAnalysis(row.payload) : undefined
    }));
  }

  const db = await readLocal();
  const latestBySymbol = new Map<string, PersistedAnalysis>();
  for (const row of db.analyses) {
    if (row.userId !== userId && row.userId !== null) {
      continue;
    }
    if (!latestBySymbol.has(row.analysis.symbol)) {
      latestBySymbol.set(row.analysis.symbol, row.analysis);
    }
  }

  return db.watchlist
    .filter((item) => item.userId === userId)
    .map((item) => ({
      symbol: item.symbol,
      createdAt: item.createdAt,
      latest: latestBySymbol.get(item.symbol)
    }));
}
