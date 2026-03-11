import { getFetchSignal } from "@/lib/market/adapter-utils";
import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { fetchSP500Directory } from "@/lib/market/sp500";
import type { HomeMarketMoverItem } from "@/lib/home/dashboard-types";

type DirectoryMap = Record<string, { companyName: string }>;

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const YAHOO_SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const CHUNK_SIZE = 75;
const MAX_SYMBOLS = 520;
const FETCH_TIMEOUT_MS = 1_200;
const CACHE_TTL_MS = 120_000;
const REDIS_TTL_SECONDS = 120;
const DEFAULT_FALLBACK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];

let moversCache: { expiresAt: number; movers: HomeMarketMoverItem[] } | null = null;
let moversInFlight: Promise<HomeMarketMoverItem[]> | null = null;

function moversRedisKey(limit: number): string {
  return `home:movers:v1:${limit}`;
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

async function buildMovers(limit: number): Promise<HomeMarketMoverItem[]> {
  const directory = await loadDirectory();
  const hasSp500Directory = Object.keys(directory).length >= 450;

  const [gainersRows, losersRows] = await Promise.all([
    fetchYahooScreenerRows("day_gainers", 250),
    fetchYahooScreenerRows("day_losers", 250)
  ]);
  let movers = sortBiggestMoves(mapQuoteRows([...gainersRows, ...losersRows], directory, hasSp500Directory)).slice(0, limit);

  if (movers.length < limit) {
    const universe = Object.keys(directory).slice(0, MAX_SYMBOLS).map(toYahooSymbol);
    const bulkRows = await fetchYahooQuotes(universe);
    movers = sortBiggestMoves(mapQuoteRows(bulkRows, directory, hasSp500Directory)).slice(0, limit);
  }

  if (movers.length < limit) {
    const fallbackRows = await fetchYahooQuotes(DEFAULT_FALLBACK_SYMBOLS.map(toYahooSymbol));
    movers = sortBiggestMoves(mapQuoteRows(fallbackRows, directory, false)).slice(0, limit);
  }

  return movers;
}

export async function fetchTopSp500Movers(limit = 3): Promise<HomeMarketMoverItem[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, 20));
  if (moversCache && moversCache.expiresAt > Date.now() && moversCache.movers.length >= normalizedLimit) {
    return moversCache.movers.slice(0, normalizedLimit);
  }

  const redisCached = await cacheGetJson<HomeMarketMoverItem[]>(moversRedisKey(normalizedLimit));
  if (Array.isArray(redisCached) && redisCached.length >= normalizedLimit) {
    moversCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      movers: redisCached
    };
    return redisCached.slice(0, normalizedLimit);
  }

  if (!moversInFlight) {
    moversInFlight = buildMovers(normalizedLimit)
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
  return movers.slice(0, normalizedLimit);
}
