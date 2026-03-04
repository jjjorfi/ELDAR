import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "@vercel/postgres";

import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import type { PersistedPortfolioSnapshot, PortfolioRating, PortfolioSnapshotHolding } from "@/lib/scoring/portfolio-types";
import { SCORING_MODEL_VERSION } from "@/lib/scoring/version";
import type { AnalysisResult, Mag7ScoreCard, PersistedAnalysis, WatchlistItem } from "@/lib/types";

const hasPostgres = Boolean(process.env.POSTGRES_URL);
let initialized = false;
const ANALYSIS_REDIS_KEY_PREFIX = "analysis";
const PORTFOLIO_REDIS_KEY_PREFIX = "portfolio";

function getCacheWindowMinutes(): number {
  const parsed = Number.parseInt(process.env.ANALYSIS_CACHE_MINUTES ?? "15", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

function resolveLocalDbPath(): string {
  const fallback = process.env.VERCEL ? "/tmp/stock-ratings-store.json" : "./data/analyses.json";
  const configured = process.env.LOCAL_DB_PATH ?? fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

const localDbPath = resolveLocalDbPath();

interface LocalDbShape {
  analyses: Array<{ userId: string | null; analysis: PersistedAnalysis }>;
  watchlist: Array<{ userId: string | null; symbol: string; createdAt: string }>;
  mag7Scores: Mag7ScoreCard[];
  portfolioSnapshots: PersistedPortfolioSnapshot[];
}

function analysisRedisKey(symbol: string, userId: string | null): string {
  return `${ANALYSIS_REDIS_KEY_PREFIX}:${userId ?? "anon"}:${symbol.toUpperCase()}`;
}

function portfolioRedisKey(userId: string, portfolioId: string): string {
  return `${PORTFOLIO_REDIS_KEY_PREFIX}:${userId}:${portfolioId}`;
}

function makeId(): string {
  return crypto.randomUUID();
}

function normalizePersistedAnalysis(payload: unknown): PersistedAnalysis {
  if (typeof payload === "string") {
    return normalizePersistedAnalysis(JSON.parse(payload));
  }

  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid analysis payload shape from store");
  }

  return payload as PersistedAnalysis;
}

function shouldRefreshCachedAnalysis(analysis: PersistedAnalysis): boolean {
  if (analysis.modelVersion !== SCORING_MODEL_VERSION) {
    return true;
  }

  const sector = (analysis.sector ?? "").trim().toLowerCase();
  if (!sector || sector === "other" || sector === "unknown") {
    return true;
  }

  return analysis.factors.some(
    (factor) =>
      /No data|Insufficient|No D\/E data|No Forward P\/E|No RSI value|No MACD data|Proxy FCF|Proxy D\/E|Proxy Forward|N\/A|unavailable/i.test(
        factor.metricValue
      ) || /No .* data|Unavailable|Insufficient|Fallback/i.test(factor.ruleMatched)
  );
}

async function ensurePostgres(): Promise<void> {
  if (!hasPostgres || initialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      symbol TEXT NOT NULL,
      company_name TEXT NOT NULL,
      score INTEGER NOT NULL,
      rating TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS analyses_symbol_created_idx ON analyses(symbol, created_at DESC)`;
  await sql`ALTER TABLE analyses ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS analyses_user_created_idx ON analyses(user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id TEXT NOT NULL DEFAULT 'legacy',
      symbol TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`CREATE INDEX IF NOT EXISTS watchlist_user_created_idx ON watchlist(user_id, created_at DESC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS watchlist_user_symbol_idx ON watchlist(user_id, symbol)`;
  try {
    await sql`ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_pkey`;
    await sql`ALTER TABLE watchlist ADD PRIMARY KEY (user_id, symbol)`;
  } catch {
    // Ignore if already migrated or if constraint naming differs.
  }

  await sql`
    CREATE TABLE IF NOT EXISTS mag7_scores (
      symbol TEXT PRIMARY KEY,
      score DOUBLE PRECISION NOT NULL,
      rating TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      portfolio_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_created_idx ON portfolio_snapshots(user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_portfolio_idx ON portfolio_snapshots(user_id, portfolio_id, created_at DESC)`;

  initialized = true;
}

async function readLocal(): Promise<LocalDbShape> {
  try {
    const raw = await fs.readFile(localDbPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalDbShape>;

    const rawAnalyses = Array.isArray(parsed.analyses) ? parsed.analyses : [];
    const analyses = rawAnalyses
      .map((row) => {
        if (typeof row === "object" && row !== null && "analysis" in row) {
          const record = row as { userId?: unknown; analysis?: unknown };
          if (!record.analysis) return null;
          return {
            userId: typeof record.userId === "string" ? record.userId : null,
            analysis: normalizePersistedAnalysis(record.analysis)
          };
        }

        return {
          userId: null,
          analysis: normalizePersistedAnalysis(row)
        };
      })
      .filter((row): row is { userId: string | null; analysis: PersistedAnalysis } => row !== null);

    const rawWatchlist = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
    const watchlist = rawWatchlist
      .map((row) => {
        if (typeof row !== "object" || row === null) return null;
        const record = row as { userId?: unknown; symbol?: unknown; createdAt?: unknown };
        if (typeof record.symbol !== "string" || record.symbol.trim().length === 0) return null;
        return {
          userId: typeof record.userId === "string" ? record.userId : null,
          symbol: record.symbol.trim().toUpperCase(),
          createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString()
        };
      })
      .filter((row): row is { userId: string | null; symbol: string; createdAt: string } => row !== null);

    const rawPortfolioSnapshots = Array.isArray((parsed as { portfolioSnapshots?: unknown[] }).portfolioSnapshots)
      ? ((parsed as { portfolioSnapshots?: unknown[] }).portfolioSnapshots ?? [])
      : [];
    const portfolioSnapshots = rawPortfolioSnapshots
      .map((row) => {
        if (typeof row !== "object" || row === null) return null;
        const record = row as Partial<PersistedPortfolioSnapshot>;
        if (typeof record.id !== "string" || typeof record.userId !== "string" || typeof record.portfolioId !== "string") {
          return null;
        }
        if (typeof record.createdAt !== "string" || typeof record.asOfDate !== "string") {
          return null;
        }
        if (typeof record.rating !== "object" || record.rating === null || !Array.isArray(record.holdings)) {
          return null;
        }

        return record as PersistedPortfolioSnapshot;
      })
      .filter((row): row is PersistedPortfolioSnapshot => row !== null);

    return {
      analyses,
      watchlist,
      mag7Scores: Array.isArray((parsed as { mag7Scores?: unknown[] }).mag7Scores)
        ? ((parsed as { mag7Scores?: Mag7ScoreCard[] }).mag7Scores ?? [])
        : [],
      portfolioSnapshots
    };
  } catch {
    return {
      analyses: [],
      watchlist: [],
      mag7Scores: [],
      portfolioSnapshots: []
    };
  }
}

async function writeLocal(next: LocalDbShape): Promise<void> {
  await fs.mkdir(path.dirname(localDbPath), { recursive: true });
  await fs.writeFile(localDbPath, JSON.stringify(next, null, 2), "utf8");
}

export async function saveAnalysis(result: AnalysisResult, userId: string | null = null): Promise<PersistedAnalysis> {
  const persisted: PersistedAnalysis = {
    ...result,
    id: makeId(),
    createdAt: new Date().toISOString()
  };

  if (hasPostgres) {
    await ensurePostgres();

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
    await ensurePostgres();

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
    await ensurePostgres();

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

  if (!cached) {
    return null;
  }

  if (shouldRefreshCachedAnalysis(cached.analysis)) {
    return null;
  }

  await cacheSetJson(redisKey, cached.analysis, minutes * 60);
  return cached.analysis;
}

export async function getLastKnownPrice(symbol: string): Promise<number | null> {
  const normalized = symbol.toUpperCase();

  if (hasPostgres) {
    await ensurePostgres();

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

  if (!latest) {
    return null;
  }

  return typeof latest.currentPrice === "number" && Number.isFinite(latest.currentPrice) && latest.currentPrice > 0
    ? latest.currentPrice
    : null;
}

export async function addToWatchlist(symbol: string, userId: string): Promise<void> {
  const normalized = symbol.toUpperCase();

  if (hasPostgres) {
    await ensurePostgres();
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
    await ensurePostgres();
    await sql`DELETE FROM watchlist WHERE symbol = ${normalized} AND user_id = ${userId}`;
    return;
  }

  const db = await readLocal();
  db.watchlist = db.watchlist.filter((item) => !(item.symbol === normalized && item.userId === userId));
  await writeLocal(db);
}

export async function getWatchlist(userId: string): Promise<WatchlistItem[]> {
  if (hasPostgres) {
    await ensurePostgres();

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

  return db.watchlist
    .filter((item) => item.userId === userId)
    .map((item) => ({
      symbol: item.symbol,
      createdAt: item.createdAt,
      latest: db.analyses.find((analysis) => (analysis.userId === userId || analysis.userId === null) && analysis.analysis.symbol === item.symbol)
        ?.analysis
    }));
}

export async function saveMag7Scores(cards: Mag7ScoreCard[]): Promise<void> {
  if (hasPostgres) {
    await ensurePostgres();

    for (const card of cards) {
      await sql`
        INSERT INTO mag7_scores (symbol, score, rating, payload, updated_at)
        VALUES (${card.symbol}, ${card.score}, ${card.rating}, ${JSON.stringify(card)}::jsonb, ${card.updatedAt})
        ON CONFLICT (symbol)
        DO UPDATE SET
          score = EXCLUDED.score,
          rating = EXCLUDED.rating,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      `;
    }

    return;
  }

  const db = await readLocal();
  const bySymbol = new Map(db.mag7Scores.map((row) => [row.symbol, row]));
  for (const card of cards) {
    bySymbol.set(card.symbol, card);
  }
  db.mag7Scores = Array.from(bySymbol.values());
  await writeLocal(db);
}

export async function getMag7Scores(): Promise<Mag7ScoreCard[]> {
  if (hasPostgres) {
    await ensurePostgres();

    const { rows } = await sql<{ payload: Mag7ScoreCard }>`
      SELECT payload
      FROM mag7_scores
      ORDER BY score DESC, symbol ASC
    `;

    return rows.map((row) => row.payload).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  }

  const db = await readLocal();
  return [...db.mag7Scores].sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}

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
    await ensurePostgres();
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
    await ensurePostgres();
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
