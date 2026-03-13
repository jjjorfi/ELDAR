import { sql } from "@vercel/postgres";
import { z } from "zod";

import { env } from "@/lib/env";
import { ExternalAPIError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { cacheGetJson, cacheSetJson, cacheSetString } from "@/lib/cache/redis";
import { REDIS_KEYS } from "@/lib/redis/keys";
import sp500Seed from "@/lib/market/universe/sp500-seed.json";

const TV_SCAN_URL = "https://scanner.tradingview.com/america/scan";
const TV_BATCH_SIZE = 50;
const TV_REFRESH_TTL_SECONDS = 14_400;
const TV_LAST_RUN_TTL_SECONDS = 86_400;
const TV_COVERAGE_TTL_SECONDS = 86_400;
const TV_REQUEST_TIMEOUT_MS = 8_000;
const TV_BATCH_DELAY_MS = 3_000;
const TV_RETRY_LIMIT = 3;
const TV_SCHEMA_VERSION = "tv-fundamentals-v1";

type SeedRow = {
  symbol: string;
};

export const SP500_TICKERS: string[] = (sp500Seed as SeedRow[]).map((row) => row.symbol.toUpperCase());

// Live TradingView screener fields. The prompt's original field names drifted in a
// few places; these are the currently working equivalents verified against the live endpoint.
export const TV_COLUMNS = [
  "name",
  "close",
  "change",
  "market_cap_basic",
  "price_earnings_ttm",
  "earnings_per_share_forecast_next_fy",
  "price_book_ratio",
  "price_revenue_ttm",
  "enterprise_value_ebitda_ttm",
  "gross_margin",
  "operating_margin_ttm",
  "net_margin_ttm",
  "return_on_equity",
  "return_on_assets",
  "return_on_invested_capital",
  "total_revenue_yoy_growth_ttm",
  "earnings_per_share_diluted_yoy_growth_ttm",
  "free_cash_flow_ttm",
  "cash_f_operating_activities_ttm",
  "net_income_ttm",
  "total_revenue_ttm",
  "debt_to_equity",
  "current_ratio",
  "quick_ratio",
  "total_debt_fq",
  "total_assets_fq",
  "cash_n_equivalents_fq",
  "earnings_per_share_diluted_ttm",
  "dividend_yield_recent",
  "Recommend.All",
  "RSI",
  "SMA20",
  "SMA50",
  "SMA200",
  "average_volume_30d_calc"
] as const;

export interface CanonicalFundamentals {
  ticker: string;
  source: "tradingview";
  fetchedAt: string;
  peRatioTTM: number | null;
  forwardPE: number | null;
  pbRatio: number | null;
  psRatioTTM: number | null;
  evEbitda: number | null;
  marketCapUSD: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  roePct: number | null;
  roaPct: number | null;
  roicPct: number | null;
  revenueGrowthYoYPct: number | null;
  epsGrowthYoYPct: number | null;
  freeCashFlowTTM: number | null;
  operatingCashFlowTTM: number | null;
  netIncomeTTM: number | null;
  revenueTTM: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  totalDebt: number | null;
  totalAssets: number | null;
  cash: number | null;
  epsDilutedTTM: number | null;
  dividendYieldPct: number | null;
  analystRecommendation: number | null;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  priceClose: number | null;
  changePct1D: number | null;
  avgVolume30D: number | null;
}

export interface TVFundamentalsCoverageReport {
  generatedAt: string;
  universeSize: number;
  coveredCount: number;
  uncoveredCount: number;
  coverageRatio: number;
  uncoveredTickers: string[];
}

type TVScanData = {
  s: string;
  d: unknown[];
};

const TVScanResponseSchema = z.object({
  totalCount: z.number(),
  data: z.array(
    z.object({
      s: z.string(),
      d: z.array(z.unknown())
    })
  ).nullable().default([])
});

const TvStorageRowSchema = z.object({
  ticker: z.string(),
  source: z.literal("tradingview"),
  fetchedAt: z.string(),
  peRatioTTM: z.number().nullable(),
  forwardPE: z.number().nullable(),
  pbRatio: z.number().nullable(),
  psRatioTTM: z.number().nullable(),
  evEbitda: z.number().nullable(),
  marketCapUSD: z.number().nullable(),
  grossMarginPct: z.number().nullable(),
  operatingMarginPct: z.number().nullable(),
  netMarginPct: z.number().nullable(),
  roePct: z.number().nullable(),
  roaPct: z.number().nullable(),
  roicPct: z.number().nullable(),
  revenueGrowthYoYPct: z.number().nullable(),
  epsGrowthYoYPct: z.number().nullable(),
  freeCashFlowTTM: z.number().nullable(),
  operatingCashFlowTTM: z.number().nullable(),
  netIncomeTTM: z.number().nullable(),
  revenueTTM: z.number().nullable(),
  debtToEquity: z.number().nullable(),
  currentRatio: z.number().nullable(),
  quickRatio: z.number().nullable(),
  totalDebt: z.number().nullable(),
  totalAssets: z.number().nullable(),
  cash: z.number().nullable(),
  epsDilutedTTM: z.number().nullable(),
  dividendYieldPct: z.number().nullable(),
  analystRecommendation: z.number().nullable(),
  rsi14: z.number().nullable(),
  sma20: z.number().nullable(),
  sma50: z.number().nullable(),
  sma200: z.number().nullable(),
  priceClose: z.number().nullable(),
  changePct1D: z.number().nullable(),
  avgVolume30D: z.number().nullable()
});

let tableEnsured = false;

function safeNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function hasPostgresConfigured(): boolean {
  return env.POSTGRES_URL.length > 0;
}

function chunk<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function parseDateMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshFetchedAt(fetchedAt: string, maxAgeMs = TV_REFRESH_TTL_SECONDS * 1000): boolean {
  return Date.now() - parseDateMs(fetchedAt) < maxAgeMs;
}

function normalizePercentToDecimal(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return value / 100;
}

function buildCoverageReport(foundTickers: Iterable<string>): TVFundamentalsCoverageReport {
  const covered = new Set([...foundTickers].map(normalizeTicker).filter(Boolean));
  const uncoveredTickers = SP500_TICKERS.filter((ticker) => !covered.has(ticker));
  const universeSize = SP500_TICKERS.length;
  const coveredCount = universeSize - uncoveredTickers.length;

  return {
    generatedAt: new Date().toISOString(),
    universeSize,
    coveredCount,
    uncoveredCount: uncoveredTickers.length,
    coverageRatio: universeSize > 0 ? coveredCount / universeSize : 0,
    uncoveredTickers
  };
}

function extractTicker(row: TVScanData): string {
  const primary = typeof row.s === "string" && row.s.length > 0 ? row.s : String(row.d[0] ?? "");
  const stripped = primary.replace(/^[^:]+:/, "").trim().toUpperCase();
  return stripped.length > 0 ? stripped : normalizeTicker(String(row.d[0] ?? ""));
}

/**
 * Converts TradingView's recommendation signal to the 0-10 bullish scale used downstream.
 * Supports the live -1..1 TradingView range and the older 1..5 description in the prompt.
 */
export function analystRecToScore(rec: number | null): number | null {
  if (rec === null) {
    return null;
  }

  if (rec >= -1 && rec <= 1) {
    return Math.max(0, Math.min(10, ((rec + 1) / 2) * 10));
  }

  const clamped = Math.max(1, Math.min(5, rec));
  return Math.max(0, Math.min(10, ((5 - clamped) / 4) * 10));
}

/**
 * Maps one TradingView screener row into ELDAR's canonical fundamentals shape.
 */
export function mapRow(row: TVScanData): CanonicalFundamentals {
  const d = row.d;
  const ticker = extractTicker(row);
  const priceClose = safeNum(d[1]);
  const epsForwardNextFy = safeNum(d[5]);
  const forwardPE =
    priceClose !== null && epsForwardNextFy !== null && epsForwardNextFy !== 0
      ? priceClose / epsForwardNextFy
      : null;

  return {
    ticker,
    source: "tradingview",
    fetchedAt: new Date().toISOString(),
    peRatioTTM: safeNum(d[4]),
    forwardPE,
    pbRatio: safeNum(d[6]),
    psRatioTTM: safeNum(d[7]),
    evEbitda: safeNum(d[8]),
    marketCapUSD: safeNum(d[3]),
    grossMarginPct: normalizePercentToDecimal(safeNum(d[9])),
    operatingMarginPct: normalizePercentToDecimal(safeNum(d[10])),
    netMarginPct: normalizePercentToDecimal(safeNum(d[11])),
    roePct: normalizePercentToDecimal(safeNum(d[12])),
    roaPct: normalizePercentToDecimal(safeNum(d[13])),
    roicPct: normalizePercentToDecimal(safeNum(d[14])),
    revenueGrowthYoYPct: normalizePercentToDecimal(safeNum(d[15])),
    epsGrowthYoYPct: normalizePercentToDecimal(safeNum(d[16])),
    freeCashFlowTTM: safeNum(d[17]),
    operatingCashFlowTTM: safeNum(d[18]),
    netIncomeTTM: safeNum(d[19]),
    revenueTTM: safeNum(d[20]),
    debtToEquity: safeNum(d[21]),
    currentRatio: safeNum(d[22]),
    quickRatio: safeNum(d[23]),
    totalDebt: safeNum(d[24]),
    totalAssets: safeNum(d[25]),
    cash: safeNum(d[26]),
    epsDilutedTTM: safeNum(d[27]),
    dividendYieldPct: normalizePercentToDecimal(safeNum(d[28])),
    analystRecommendation: safeNum(d[29]),
    rsi14: safeNum(d[30]),
    sma20: safeNum(d[31]),
    sma50: safeNum(d[32]),
    sma200: safeNum(d[33]),
    priceClose,
    changePct1D: safeNum(d[2]),
    avgVolume30D: safeNum(d[34])
  };
}

function serializeForStorage(record: CanonicalFundamentals): CanonicalFundamentals {
  return TvStorageRowSchema.parse(record);
}

async function ensureTvFundamentalsStore(): Promise<void> {
  if (!hasPostgresConfigured() || tableEnsured) {
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS eldar_tv_fundamentals (
      ticker TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tv_fund_fetched ON eldar_tv_fundamentals(fetched_at DESC)`;
  tableEnsured = true;
}

async function fetchTvScanBatch(tickers: string[]): Promise<Map<string, CanonicalFundamentals>> {
  const normalizedTickers = tickers.map(normalizeTicker).filter(Boolean);
  if (normalizedTickers.length === 0) {
    return new Map();
  }

  const payload = JSON.stringify({
    filter: [
      {
        left: "name",
        operation: "in_range",
        right: normalizedTickers
      }
    ],
    columns: [...TV_COLUMNS],
    range: [0, normalizedTickers.length]
  });

  let attempt = 0;
  while (attempt <= TV_RETRY_LIMIT) {
    try {
      const response = await fetch(TV_SCAN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://www.tradingview.com",
          Referer: "https://www.tradingview.com/",
          "User-Agent": "Mozilla/5.0 (compatible; ELDAR/1.0; +https://eldar.app)"
        },
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(TV_REQUEST_TIMEOUT_MS)
      });

      if (response.status === 429) {
        if (attempt === TV_RETRY_LIMIT) {
          throw new ExternalAPIError("tradingview", "Rate limited", { tickers: normalizedTickers, attempt });
        }
        await sleep(6_000 * 2 ** attempt);
        attempt += 1;
        continue;
      }

      if (response.status >= 500) {
        if (attempt === TV_RETRY_LIMIT) {
          throw new ExternalAPIError("tradingview", `Server error ${response.status}`, { tickers: normalizedTickers, attempt });
        }
        await sleep(TV_BATCH_DELAY_MS);
        attempt += 1;
        continue;
      }

      if (!response.ok) {
        throw new ExternalAPIError("tradingview", `HTTP ${response.status}`, { tickers: normalizedTickers });
      }

      const json = await response.json();
      const parsed = TVScanResponseSchema.parse(json);
      const mapped = new Map<string, CanonicalFundamentals>();
      for (const row of parsed.data ?? []) {
        const canonical = serializeForStorage(mapRow(row));
        mapped.set(canonical.ticker, canonical);
      }
      return mapped;
    } catch (error) {
      if (attempt >= TV_RETRY_LIMIT) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      log({
        level: "warn",
        service: "tv-fundamentals",
        message: "TradingView batch fetch retrying",
        tickers: normalizedTickers,
        attempt: attempt + 1,
        error: message
      });
      await sleep(TV_BATCH_DELAY_MS);
      attempt += 1;
    }
  }

  return new Map();
}

async function writeBatchToRedis(records: Iterable<CanonicalFundamentals>): Promise<void> {
  await Promise.all(
    [...records].map((record) =>
      cacheSetJson(REDIS_KEYS.tvFundamentals(record.ticker), record, TV_REFRESH_TTL_SECONDS)
    )
  );
}

async function writeBatchToPostgres(records: CanonicalFundamentals[]): Promise<void> {
  if (!hasPostgresConfigured() || records.length === 0) {
    return;
  }

  await ensureTvFundamentalsStore();

  const rows = records.map((record) => ({
    ticker: record.ticker,
    data: record,
    fetched_at: record.fetchedAt
  }));

  await sql`
    INSERT INTO eldar_tv_fundamentals (ticker, data, fetched_at, updated_at)
    SELECT row.ticker, row.data, row.fetched_at, NOW()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS row(
      ticker TEXT,
      data JSONB,
      fetched_at TIMESTAMPTZ
    )
    ON CONFLICT (ticker)
    DO UPDATE SET
      data = EXCLUDED.data,
      fetched_at = EXCLUDED.fetched_at,
      updated_at = NOW()
  `;
}

async function loadFromPostgres(tickers: string[]): Promise<{
  fresh: Map<string, CanonicalFundamentals>;
  stale: Map<string, CanonicalFundamentals>;
}> {
  const normalizedTickers = tickers.map(normalizeTicker).filter(Boolean);
  if (!hasPostgresConfigured() || normalizedTickers.length === 0) {
    return { fresh: new Map(), stale: new Map() };
  }

  await ensureTvFundamentalsStore();

  const result = await sql.query<{
    ticker: string;
    data: unknown;
    fetched_at: string;
  }>(
    "SELECT ticker, data, fetched_at FROM eldar_tv_fundamentals WHERE ticker = ANY($1::text[])",
    [normalizedTickers]
  );

  const fresh = new Map<string, CanonicalFundamentals>();
  const stale = new Map<string, CanonicalFundamentals>();

  for (const row of result.rows) {
    const parsed = TvStorageRowSchema.safeParse(row.data);
    if (!parsed.success) {
      log({
        level: "warn",
        service: "tv-fundamentals",
        message: "Discarded invalid TradingView fundamentals row from Postgres",
        ticker: row.ticker
      });
      continue;
    }

    const record = parsed.data;
    if (isFreshFetchedAt(row.fetched_at || record.fetchedAt)) {
      fresh.set(record.ticker, record);
    } else {
      stale.set(record.ticker, record);
    }
  }

  return { fresh, stale };
}

async function fetchLiveAndPersist(tickers: string[]): Promise<Map<string, CanonicalFundamentals>> {
  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
  if (normalizedTickers.length === 0) {
    return new Map();
  }

  const batches = chunk(normalizedTickers, TV_BATCH_SIZE);
  const results = new Map<string, CanonicalFundamentals>();

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index] ?? [];
    try {
      const mapped = await fetchTvScanBatch(batch);
      const records = [...mapped.values()];
      await writeBatchToRedis(records);
      try {
        await writeBatchToPostgres(records);
      } catch (error) {
        log({
          level: "warn",
          service: "tv-fundamentals",
          message: "TradingView fundamentals Postgres write failed",
          batch,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      for (const [ticker, record] of mapped) {
        results.set(ticker, record);
      }

      log({
        level: "info",
        service: "tv-fundamentals",
        message: `[TV] batch ${index + 1}/${batches.length} — ${mapped.size} rows`,
        batchTickers: batch,
        batchSize: batch.length
      });
    } catch (error) {
      log({
        level: "warn",
        service: "tv-fundamentals",
        message: "TradingView batch fetch failed",
        batch,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (index < batches.length - 1) {
      await sleep(TV_BATCH_DELAY_MS);
    }
  }

  return results;
}

/**
 * Get fundamentals for one ticker.
 * Cache-first: Redis → Neon → live fetch.
 */
export async function getTVFundamentals(ticker: string): Promise<CanonicalFundamentals | null> {
  try {
    const normalizedTicker = normalizeTicker(ticker);
    if (!normalizedTicker) {
      return null;
    }

    const cached = await cacheGetJson<CanonicalFundamentals>(REDIS_KEYS.tvFundamentals(normalizedTicker));
    if (cached) {
      const parsed = TvStorageRowSchema.safeParse(cached);
      if (parsed.success) {
        return parsed.data;
      }
    }

    const { fresh, stale } = await loadFromPostgres([normalizedTicker]);
    const fromPostgres = fresh.get(normalizedTicker);
    if (fromPostgres) {
      await cacheSetJson(REDIS_KEYS.tvFundamentals(normalizedTicker), fromPostgres, TV_REFRESH_TTL_SECONDS);
      return fromPostgres;
    }

    const live = await fetchLiveAndPersist([normalizedTicker]);
    return live.get(normalizedTicker) ?? stale.get(normalizedTicker) ?? null;
  } catch (error) {
    log({
      level: "warn",
      service: "tv-fundamentals",
      message: "TradingView single-ticker lookup failed",
      ticker,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Get fundamentals for multiple tickers.
 * Cache-first: Redis → Neon → live fetch in <=50-symbol batches.
 */
export async function getTVFundamentalsMultiple(tickers: string[]): Promise<Map<string, CanonicalFundamentals>> {
  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
  const results = new Map<string, CanonicalFundamentals>();
  if (normalizedTickers.length === 0) {
    return results;
  }

  try {
    const cacheRows = await Promise.all(
      normalizedTickers.map(async (ticker) => {
        const cached = await cacheGetJson<CanonicalFundamentals>(REDIS_KEYS.tvFundamentals(ticker));
        const parsed = TvStorageRowSchema.safeParse(cached);
        return parsed.success ? [ticker, parsed.data] as const : null;
      })
    );

    for (const row of cacheRows) {
      if (!row) {
        continue;
      }
      results.set(row[0], row[1]);
    }

    const missingAfterRedis = normalizedTickers.filter((ticker) => !results.has(ticker));
    if (missingAfterRedis.length === 0) {
      return results;
    }

    const { fresh, stale } = await loadFromPostgres(missingAfterRedis);
    for (const [ticker, record] of fresh) {
      results.set(ticker, record);
    }
    await writeBatchToRedis(fresh.values());

    const unresolved = missingAfterRedis.filter((ticker) => !fresh.has(ticker));
    if (unresolved.length === 0) {
      return results;
    }

    const live = await fetchLiveAndPersist(unresolved);
    for (const [ticker, record] of live) {
      results.set(ticker, record);
    }

    for (const ticker of unresolved) {
      if (!results.has(ticker) && stale.has(ticker)) {
        results.set(ticker, stale.get(ticker)!);
      }
    }

    return results;
  } catch (error) {
    log({
      level: "warn",
      service: "tv-fundamentals",
      message: "TradingView multi-ticker lookup failed",
      tickers: normalizedTickers,
      error: error instanceof Error ? error.message : String(error)
    });
    return results;
  }
}

/**
 * Run the full S&P 500 TradingView fundamentals refresh.
 */
export async function runSP500FundamentalsRefresh(): Promise<{
  fetched: number;
  failed: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  let fetched = 0;
  let failed = 0;
  const foundTickers = new Set<string>();

  const batches = chunk(SP500_TICKERS, TV_BATCH_SIZE);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index] ?? [];
    try {
      const mapped = await fetchTvScanBatch(batch);
      const records = [...mapped.values()];
      fetched += records.length;
      for (const record of records) {
        foundTickers.add(record.ticker);
      }
      failed += Math.max(0, batch.length - records.length);
      await writeBatchToRedis(records);
      try {
        await writeBatchToPostgres(records);
      } catch (error) {
        log({
          level: "warn",
          service: "tv-fundamentals",
          message: "TradingView fundamentals Postgres batch write failed",
          batch,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      log({
        level: "info",
        service: "tv-fundamentals",
        message: `[TV] batch ${index + 1}/${batches.length} — ${mapped.size} rows`,
        batchTickers: batch
      });
    } catch (error) {
      failed += batch.length;
      log({
        level: "warn",
        service: "tv-fundamentals",
        message: "TradingView fundamentals refresh batch failed",
        batch,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (index < batches.length - 1) {
      await sleep(TV_BATCH_DELAY_MS);
    }
  }

  await cacheSetString(REDIS_KEYS.tvFundamentalsLastRun(), new Date().toISOString(), TV_LAST_RUN_TTL_SECONDS);
  const coverageReport = buildCoverageReport(foundTickers);
  await cacheSetJson(REDIS_KEYS.tvFundamentalsCoverage(), coverageReport, TV_COVERAGE_TTL_SECONDS);
  log({
    level: "info",
    service: "tv-fundamentals",
    message: "TradingView fundamentals coverage snapshot updated",
    coveredCount: coverageReport.coveredCount,
    universeSize: coverageReport.universeSize,
    uncoveredCount: coverageReport.uncoveredCount,
    coverageRatio: coverageReport.coverageRatio
  });
  return {
    fetched,
    failed,
    durationMs: Date.now() - startedAt
  };
}

/**
 * Returns the last internal TradingView coverage snapshot when available.
 * This is for backend inspection only and is not intended for customer-facing UI.
 */
export async function getTVFundamentalsCoverageReport(): Promise<TVFundamentalsCoverageReport | null> {
  return cacheGetJson<TVFundamentalsCoverageReport>(REDIS_KEYS.tvFundamentalsCoverage());
}

/**
 * Converts TradingView fundamentals into the subset consumed by the V8.1 fallback path.
 */
export function toV81Input(fundamentals: CanonicalFundamentals): {
  peRatioTTM: number | null;
  forwardPE: number | null;
  pbRatio: number | null;
  evEbitda: number | null;
  roePct: number | null;
  roaPct: number | null;
  roicPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  revenueGrowthYoYPct: number | null;
  epsGrowthYoYPct: number | null;
  freeCashFlowTTM: number | null;
  operatingCashFlowTTM: number | null;
  netIncomeTTM: number | null;
  revenueTTM: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  analystScore: number | null;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  priceClose: number | null;
  changePct1D: number | null;
} {
  return {
    peRatioTTM: fundamentals.peRatioTTM,
    forwardPE: fundamentals.forwardPE,
    pbRatio: fundamentals.pbRatio,
    evEbitda: fundamentals.evEbitda,
    roePct: fundamentals.roePct,
    roaPct: fundamentals.roaPct,
    roicPct: fundamentals.roicPct,
    operatingMarginPct: fundamentals.operatingMarginPct,
    netMarginPct: fundamentals.netMarginPct,
    revenueGrowthYoYPct: fundamentals.revenueGrowthYoYPct,
    epsGrowthYoYPct: fundamentals.epsGrowthYoYPct,
    freeCashFlowTTM: fundamentals.freeCashFlowTTM,
    operatingCashFlowTTM: fundamentals.operatingCashFlowTTM,
    netIncomeTTM: fundamentals.netIncomeTTM,
    revenueTTM: fundamentals.revenueTTM,
    debtToEquity: fundamentals.debtToEquity,
    currentRatio: fundamentals.currentRatio,
    quickRatio: fundamentals.quickRatio,
    analystScore: analystRecToScore(fundamentals.analystRecommendation),
    rsi14: fundamentals.rsi14,
    sma20: fundamentals.sma20,
    sma50: fundamentals.sma50,
    sma200: fundamentals.sma200,
    priceClose: fundamentals.priceClose,
    changePct1D: fundamentals.changePct1D
  };
}

export const __test__ = {
  safeNum,
  mapRow,
  normalizePercentToDecimal,
  extractTicker,
  TV_SCHEMA_VERSION
};
