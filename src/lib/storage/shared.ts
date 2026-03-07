import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "@vercel/postgres";

import type { PersistedPortfolioSnapshot } from "@/lib/scoring/portfolio-types";
import { SCORING_MODEL_VERSION } from "@/lib/scoring/version";
import type { Mag7ScoreCard, PersistedAnalysis } from "@/lib/types";

export const hasPostgres = Boolean(process.env.POSTGRES_URL);

const ANALYSIS_REDIS_KEY_PREFIX = "analysis";
const PORTFOLIO_REDIS_KEY_PREFIX = "portfolio";

const ensuredStores = {
  analyses: false,
  watchlist: false,
  mag7: false,
  portfolio: false
};

function resolveLocalDbPath(): string {
  const fallback = process.env.VERCEL ? "/tmp/stock-ratings-store.json" : "./data/analyses.json";
  const configured = process.env.LOCAL_DB_PATH ?? fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

const localDbPath = resolveLocalDbPath();

export interface LocalDbShape {
  analyses: Array<{ userId: string | null; analysis: PersistedAnalysis }>;
  watchlist: Array<{ userId: string | null; symbol: string; createdAt: string }>;
  mag7Scores: Mag7ScoreCard[];
  portfolioSnapshots: PersistedPortfolioSnapshot[];
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function emptyLocalDb(): LocalDbShape {
  return {
    analyses: [],
    watchlist: [],
    mag7Scores: [],
    portfolioSnapshots: []
  };
}

export function getCacheWindowMinutes(): number {
  const parsed = Number.parseInt(process.env.ANALYSIS_CACHE_MINUTES ?? "15", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

export function analysisRedisKey(symbol: string, userId: string | null): string {
  return `${ANALYSIS_REDIS_KEY_PREFIX}:${userId ?? "anon"}:${symbol.toUpperCase()}`;
}

export function portfolioRedisKey(userId: string, portfolioId: string): string {
  return `${PORTFOLIO_REDIS_KEY_PREFIX}:${userId}:${portfolioId}`;
}

export function makeId(): string {
  return crypto.randomUUID();
}

export function normalizePersistedAnalysis(payload: unknown): PersistedAnalysis {
  if (typeof payload === "string") {
    return normalizePersistedAnalysis(JSON.parse(payload));
  }

  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid analysis payload shape from store");
  }

  return payload as PersistedAnalysis;
}

export function shouldRefreshCachedAnalysis(analysis: PersistedAnalysis): boolean {
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

export async function ensureAnalysesStore(): Promise<void> {
  if (!hasPostgres || ensuredStores.analyses) return;

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

  ensuredStores.analyses = true;
}

export async function ensureWatchlistStore(): Promise<void> {
  if (!hasPostgres || ensuredStores.watchlist) return;

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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown watchlist migration error.";
    console.warn(`[Storage]: Watchlist primary key migration skipped: ${message}`);
  }

  ensuredStores.watchlist = true;
}

export async function ensureMag7Store(): Promise<void> {
  if (!hasPostgres || ensuredStores.mag7) return;

  await sql`
    CREATE TABLE IF NOT EXISTS mag7_scores (
      symbol TEXT PRIMARY KEY,
      score DOUBLE PRECISION NOT NULL,
      rating TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  ensuredStores.mag7 = true;
}

export async function ensurePortfolioStore(): Promise<void> {
  if (!hasPostgres || ensuredStores.portfolio) return;

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

  ensuredStores.portfolio = true;
}

export async function readLocal(): Promise<LocalDbShape> {
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
  } catch (error) {
    if (isMissingFileError(error)) {
      return emptyLocalDb();
    }

    const message = error instanceof Error ? error.message : "Unknown local store error.";
    console.warn(`[Storage]: Failed to read local store ${localDbPath}: ${message}`);
    return emptyLocalDb();
  }
}

export async function writeLocal(next: LocalDbShape): Promise<void> {
  await fs.mkdir(path.dirname(localDbPath), { recursive: true });
  await fs.writeFile(localDbPath, JSON.stringify(next, null, 2), "utf8");
}
