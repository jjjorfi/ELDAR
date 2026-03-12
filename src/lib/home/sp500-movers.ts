import { getFetchSignal } from "@/lib/market/adapter-utils";
import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import type { HomeMarketMoverItem } from "@/lib/home/dashboard-types";

type DirectoryMap = Record<string, { companyName: string }>;

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const YAHOO_SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const CHUNK_SIZE = 75;
const MAX_SYMBOLS = 520;
const FETCH_TIMEOUT_MS = 1_200;
const CACHE_TTL_MS = 120_000;
const REDIS_TTL_SECONDS = 120;
const LAST_VALID_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_VALID_REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_FALLBACK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];

let moversCache: { expiresAt: number; movers: HomeMarketMoverItem[] } | null = null;
let lastValidMoversCache: { expiresAt: number; movers: HomeMarketMoverItem[] } | null = null;
let moversInFlight: Promise<HomeMarketMoverItem[]> | null = null;

function moversRedisKey(limit: number): string {
  return `home:movers:v2:${limit}`;
}

function moversLastValidRedisKey(limit: number): string {
  return `home:movers:last-valid:v1:${limit}`;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null && "raw" in value) {
    return safeNumber((value as { raw?: unknown }).raw);
  }
  return null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

function fromYahooSymbol(symbol: string): string {
  return symbol.replace(/-/g, ".");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function normalizeRowSymbol(row: Record<string, unknown>): string | null {
  const raw = safeString(row.symbol);
  if (!raw) return null;
  return fromYahooSymbol(raw.toUpperCase()) || null;
}

function mapQuoteRows(
  rows: Array<Record<string, unknown>>,
  directory: DirectoryMap,
  enforceDirectoryFilter: boolean
): HomeMarketMoverItem[] {
  const mapped: Array<HomeMarketMoverItem | null> = rows.map((row) => {
    const symbol = normalizeRowSymbol(row);
    if (!symbol) return null;
    if (enforceDirectoryFilter && !directory[symbol]) return null;

    const changePercent = safeNumber(row.regularMarketChangePercent);
    if (changePercent === null) return null;

    return {
      symbol,
      companyName: directory[symbol]?.companyName ?? safeString(row.shortName) ?? safeString(row.longName) ?? symbol,
      currentPrice: safeNumber(row.regularMarketPrice),
      changePercent
    };
  });

  const deduped = new Map<string, HomeMarketMoverItem>();
  for (const item of mapped) {
    if (!item) continue;
    const existing = deduped.get(item.symbol);
    if (!existing || Math.abs(item.changePercent) > Math.abs(existing.changePercent)) {
      deduped.set(item.symbol, item);
    }
  }
  return Array.from(deduped.values());
}

function sortBiggestMoves(items: HomeMarketMoverItem[]): HomeMarketMoverItem[] {
  return [...items].sort(
    (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent) || b.changePercent - a.changePercent || a.symbol.localeCompare(b.symbol)
  );
}

function sortWinners(items: HomeMarketMoverItem[]): HomeMarketMoverItem[] {
  return [...items]
    .filter((item) => item.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent || a.symbol.localeCompare(b.symbol));
}

function sortLosers(items: HomeMarketMoverItem[]): HomeMarketMoverItem[] {
  return [...items]
    .filter((item) => item.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent || a.symbol.localeCompare(b.symbol));
}

function dedupeByStrongestMove(items: HomeMarketMoverItem[]): HomeMarketMoverItem[] {
  const deduped = new Map<string, HomeMarketMoverItem>();
  for (const item of items) {
    const existing = deduped.get(item.symbol);
    if (!existing || Math.abs(item.changePercent) > Math.abs(existing.changePercent)) {
      deduped.set(item.symbol, item);
    }
  }
  return Array.from(deduped.values());
}

function hasRequiredBuckets(items: HomeMarketMoverItem[], perBucket: number): boolean {
  return sortWinners(items).length >= perBucket && sortLosers(items).length >= perBucket;
}

async function getLastValidMovers(limit: number): Promise<HomeMarketMoverItem[] | null> {
  if (lastValidMoversCache && lastValidMoversCache.expiresAt > Date.now() && hasRequiredBuckets(lastValidMoversCache.movers, limit)) {
    return lastValidMoversCache.movers;
  }

  const redisCached = await cacheGetJson<HomeMarketMoverItem[]>(moversLastValidRedisKey(limit));
  if (Array.isArray(redisCached) && hasRequiredBuckets(redisCached, limit)) {
    lastValidMoversCache = {
      expiresAt: Date.now() + LAST_VALID_CACHE_TTL_MS,
      movers: redisCached
    };
    return redisCached;
  }

  return null;
}

async function persistLastValidMovers(limit: number, movers: HomeMarketMoverItem[]): Promise<void> {
  lastValidMoversCache = {
    expiresAt: Date.now() + LAST_VALID_CACHE_TTL_MS,
    movers
  };
  await cacheSetJson(moversLastValidRedisKey(limit), movers, LAST_VALID_REDIS_TTL_SECONDS);
}

function fillBucketFromPrior(
  current: HomeMarketMoverItem[],
  prior: HomeMarketMoverItem[],
  perBucket: number,
  direction: "W" | "L"
): HomeMarketMoverItem[] {
  if (current.length >= perBucket) return current.slice(0, perBucket);
  const seen = new Set(current.map((item) => item.symbol));
  const candidates = direction === "W" ? sortWinners(prior) : sortLosers(prior);
  const merged = current.slice();
  for (const candidate of candidates) {
    if (merged.length >= perBucket) break;
    if (seen.has(candidate.symbol)) continue;
    merged.push(candidate);
    seen.add(candidate.symbol);
  }
  return merged.slice(0, perBucket);
}

async function fetchYahooScreenerRows(scrId: "day_gainers" | "day_losers", count = 250): Promise<Array<Record<string, unknown>>> {
  const url = new URL(YAHOO_SCREENER_URL);
  url.searchParams.set("formatted", "true");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");
  url.searchParams.set("scrIds", scrId);
  url.searchParams.set("count", String(count));

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: getFetchSignal(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      finance?: { result?: Array<{ quotes?: Array<Record<string, unknown>> }> };
    };
    const quotes = payload.finance?.result?.[0]?.quotes;
    return Array.isArray(quotes) ? quotes : [];
  } catch {
    return [];
  }
}

async function fetchYahooQuotes(symbols: string[]): Promise<Array<Record<string, unknown>>> {
  if (symbols.length === 0) return [];
  const groups = chunk(symbols, CHUNK_SIZE);
  const rowGroups = await Promise.all(
    groups.map(async (group) => {
      const url = new URL(YAHOO_QUOTE_URL);
      url.searchParams.set("symbols", group.join(","));
      try {
        const response = await fetch(url.toString(), {
          headers: { "User-Agent": "Mozilla/5.0" },
          cache: "no-store",
          signal: getFetchSignal(FETCH_TIMEOUT_MS)
        });
        if (!response.ok) return [] as Array<Record<string, unknown>>;
        const payload = (await response.json()) as { quoteResponse?: { result?: Array<Record<string, unknown>> } };
        return Array.isArray(payload.quoteResponse?.result) ? payload.quoteResponse.result : [];
      } catch {
        return [] as Array<Record<string, unknown>>;
      }
    })
  );
  return rowGroups.flat();
}

async function loadDirectory(): Promise<DirectoryMap> {
  try {
    const directory = await fetchSP500Directory();
    if (Object.keys(directory).length > 0) {
      return directory as DirectoryMap;
    }
  } catch {
    // Fall through.
  }
  return Object.fromEntries(
    DEFAULT_FALLBACK_SYMBOLS.map((symbol) => [symbol, { companyName: symbol }])
  );
}

async function buildMovers(limit: number, prior: HomeMarketMoverItem[] = []): Promise<HomeMarketMoverItem[]> {
  const directory = await loadDirectory();
  const hasSp500Directory = Object.keys(directory).length >= 450;
  const pool: HomeMarketMoverItem[] = [];

  const [gainersRows, losersRows] = await Promise.all([
    fetchYahooScreenerRows("day_gainers", 250),
    fetchYahooScreenerRows("day_losers", 250)
  ]);
  pool.push(...mapQuoteRows([...gainersRows, ...losersRows], directory, hasSp500Directory));
  let dedupedPool = dedupeByStrongestMove(pool);
  let winners = sortWinners(dedupedPool);
  let losers = sortLosers(dedupedPool);

  if (winners.length < limit || losers.length < limit) {
    const universe = Object.keys(directory).slice(0, MAX_SYMBOLS).map(toYahooSymbol);
    const bulkRows = await fetchYahooQuotes(universe);
    pool.push(...mapQuoteRows(bulkRows, directory, hasSp500Directory));
    dedupedPool = dedupeByStrongestMove(pool);
    winners = sortWinners(dedupedPool);
    losers = sortLosers(dedupedPool);
  }

  if (winners.length < limit || losers.length < limit) {
    const fallbackRows = await fetchYahooQuotes(DEFAULT_FALLBACK_SYMBOLS.map(toYahooSymbol));
    pool.push(...mapQuoteRows(fallbackRows, directory, false));
    dedupedPool = dedupeByStrongestMove(pool);
    winners = sortWinners(dedupedPool);
    losers = sortLosers(dedupedPool);
  }

  const topWinners = fillBucketFromPrior(winners, prior, limit, "W");
  const topLosers = fillBucketFromPrior(losers, prior, limit, "L");
  return sortBiggestMoves([...topWinners, ...topLosers]);
}

export async function fetchTopSp500Movers(limit = 3): Promise<HomeMarketMoverItem[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, 20));
  const requiredTotal = normalizedLimit * 2;
  if (moversCache && moversCache.expiresAt > Date.now() && hasRequiredBuckets(moversCache.movers, normalizedLimit)) {
    lastValidMoversCache = {
      expiresAt: Date.now() + LAST_VALID_CACHE_TTL_MS,
      movers: moversCache.movers
    };
    return moversCache.movers.slice(0, requiredTotal);
  }

  const redisCached = await cacheGetJson<HomeMarketMoverItem[]>(moversRedisKey(normalizedLimit));
  if (Array.isArray(redisCached) && hasRequiredBuckets(redisCached, normalizedLimit)) {
    moversCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      movers: redisCached
    };
    lastValidMoversCache = {
      expiresAt: Date.now() + LAST_VALID_CACHE_TTL_MS,
      movers: redisCached
    };
    return redisCached.slice(0, requiredTotal);
  }

  const lastValid = await getLastValidMovers(normalizedLimit);

  if (!moversInFlight) {
    const prior = Array.isArray(redisCached) ? redisCached : moversCache?.movers ?? lastValid ?? [];
    moversInFlight = buildMovers(normalizedLimit, prior)
      .then((movers) => {
        moversCache = {
          expiresAt: Date.now() + CACHE_TTL_MS,
          movers
        };
        return movers;
      })
      .finally(() => {
        moversInFlight = null;
      });
  }

  const movers = await moversInFlight;
  await cacheSetJson(moversRedisKey(normalizedLimit), movers, REDIS_TTL_SECONDS);
  if (hasRequiredBuckets(movers, normalizedLimit)) {
    await persistLastValidMovers(normalizedLimit, movers);
    return movers.slice(0, requiredTotal);
  }
  if (lastValid && hasRequiredBuckets(lastValid, normalizedLimit)) {
    return lastValid.slice(0, requiredTotal);
  }
  return movers.slice(0, requiredTotal);
}
