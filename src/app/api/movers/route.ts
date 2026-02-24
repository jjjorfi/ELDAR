import { NextResponse } from "next/server";

import { fetchSP500Directory } from "@/lib/market/sp500";
import { getTop100Sp500SymbolSet } from "@/lib/market/top100";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MarketMoverItem {
  symbol: string;
  companyName: string;
  currentPrice: number | null;
  changePercent: number | null;
}

type DirectoryMap = Record<string, { companyName: string }>;

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const YAHOO_SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const CHUNK_SIZE = 75;
const MAX_SYMBOLS = 100;
const CACHE_TTL_MS = 60_000;
const CACHE_HEADER = "public, max-age=20, s-maxage=60, stale-while-revalidate=120";
const DEFAULT_FALLBACK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];

let moversCache:
  | {
      expiresAt: number;
      payload: { movers: MarketMoverItem[] };
    }
  | null = null;

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null && "raw" in value) {
    const raw = (value as { raw?: unknown }).raw;
    return safeNumber(raw);
  }
  return null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
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
  const normalized = fromYahooSymbol(raw.toUpperCase());
  return normalized || null;
}

function mapQuoteRows(
  rows: Array<Record<string, unknown>>,
  directory: DirectoryMap,
  enforceDirectoryFilter: boolean
): MarketMoverItem[] {
  const mapped: Array<MarketMoverItem | null> = rows.map((row) => {
    const symbol = normalizeRowSymbol(row);
    if (!symbol) return null;

    if (enforceDirectoryFilter && !directory[symbol]) {
      return null;
    }

    const changePercent = safeNumber(row.regularMarketChangePercent);
    if (changePercent === null) {
      return null;
    }

    const companyName =
      directory[symbol]?.companyName ??
      safeString(row.shortName) ??
      safeString(row.longName) ??
      symbol;

    return {
      symbol,
      companyName,
      currentPrice: safeNumber(row.regularMarketPrice),
      changePercent
    };
  });

  const deduped = new Map<string, MarketMoverItem>();
  for (const item of mapped) {
    if (!item) continue;
    const existing = deduped.get(item.symbol);
    if (!existing || Math.abs(item.changePercent ?? 0) > Math.abs(existing.changePercent ?? 0)) {
      deduped.set(item.symbol, item);
    }
  }

  return Array.from(deduped.values());
}

function sortBiggestMoves(items: MarketMoverItem[]): MarketMoverItem[] {
  return [...items].sort(
    (a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0) || a.symbol.localeCompare(b.symbol)
  );
}

async function fetchYahooScreenerRows(scrId: "day_gainers" | "day_losers", count = 200): Promise<Array<Record<string, unknown>>> {
  const url = new URL(YAHOO_SCREENER_URL);
  url.searchParams.set("formatted", "true");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");
  url.searchParams.set("scrIds", scrId);
  url.searchParams.set("count", String(count));

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store"
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      finance?: { result?: Array<{ quotes?: Array<Record<string, unknown>> }> };
    };

    const quotes = payload?.finance?.result?.[0]?.quotes;
    return Array.isArray(quotes) ? quotes : [];
  } catch {
    return [];
  }
}

async function fetchYahooQuotes(symbols: string[]): Promise<Array<Record<string, unknown>>> {
  if (symbols.length === 0) return [];
  const groups = chunk(symbols, CHUNK_SIZE);
  const rows: Array<Record<string, unknown>> = [];

  for (const group of groups) {
    const url = new URL(YAHOO_QUOTE_URL);
    url.searchParams.set("symbols", group.join(","));

    try {
      const response = await fetch(url.toString(), {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store"
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as {
        quoteResponse?: { result?: Array<Record<string, unknown>> };
      };

      const result = Array.isArray(payload?.quoteResponse?.result) ? payload.quoteResponse.result : [];
      rows.push(...result);
    } catch {
      continue;
    }
  }

  return rows;
}

async function loadDirectory(): Promise<DirectoryMap> {
  const top100Symbols = getTop100Sp500SymbolSet();

  try {
    const directory = await fetchSP500Directory();
    if (Object.keys(directory).length > 0) {
      const filtered = Object.fromEntries(
        Object.entries(directory).filter(([symbol]) => top100Symbols.has(symbol))
      ) as DirectoryMap;

      if (Object.keys(filtered).length > 0) {
        return filtered;
      }
    }
  } catch {
    // Fall through to static fallback.
  }

  return Object.fromEntries(
    DEFAULT_FALLBACK_SYMBOLS.map((symbol) => [
      symbol,
      {
        companyName: symbol
      }
    ])
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const throttled = enforceRateLimit(request, {
      bucket: "api-movers",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    if (moversCache && Date.now() < moversCache.expiresAt) {
      return NextResponse.json(moversCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }

    const directory = await loadDirectory();
    const hasSp500Directory = Object.keys(directory).length > 0;

    // Primary: one-shot day gainers/losers screeners, then filter to S&P 500.
    const [gainersRows, losersRows] = await Promise.all([
      fetchYahooScreenerRows("day_gainers", 250),
      fetchYahooScreenerRows("day_losers", 250)
    ]);

    let movers = sortBiggestMoves(
      mapQuoteRows([...gainersRows, ...losersRows], directory, hasSp500Directory)
    ).slice(0, 3);

    // Secondary fallback: bulk quote for entire directory universe.
    if (movers.length < 3) {
      const universe = Object.keys(directory).slice(0, MAX_SYMBOLS).map(toYahooSymbol);
      const bulkRows = await fetchYahooQuotes(universe);
      movers = sortBiggestMoves(
        mapQuoteRows(bulkRows, directory, hasSp500Directory)
      ).slice(0, 3);
    }

    // Last fallback: MAG7 so UI never displays empty.
    if (movers.length < 3) {
      const fallbackRows = await fetchYahooQuotes(DEFAULT_FALLBACK_SYMBOLS.map(toYahooSymbol));
      movers = sortBiggestMoves(mapQuoteRows(fallbackRows, directory, false)).slice(0, 3);
    }

    if (movers.length === 0 && moversCache?.payload.movers.length) {
      return NextResponse.json(moversCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }

    const payload = { movers };
    moversCache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": CACHE_HEADER } });
  } catch (error) {
    console.error("/api/movers GET error", error);
    if (moversCache?.payload.movers.length) {
      return NextResponse.json(moversCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }
    return NextResponse.json({ movers: [] }, { status: 200, headers: { "Cache-Control": CACHE_HEADER } });
  }
}
