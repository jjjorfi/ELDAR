import { NextResponse } from "next/server";

import { resolveDomainForTicker } from "@/lib/branding/ticker-domain";
import { runRouteGuards } from "@/lib/api/route-security";
import { fetchJsonOrNull, setUrlSearchParams } from "@/lib/market/adapter-utils";
import { fetchSP500Directory, fetchSP500SectorMap } from "@/lib/market/sp500";
import { getTop100Sp500SymbolSet } from "@/lib/market/top100";
import { resolveSectorFromCandidates } from "@/lib/scoring/sector-config";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const FMP_STABLE_BASE_URL = "https://financialmodelingprep.com/stable";
const SEARCH_CACHE_TTL_MS = 90_000;
const SEARCH_CACHE_HEADER = "public, max-age=15, s-maxage=60, stale-while-revalidate=120";
const SEARCH_FETCH_TIMEOUT_MS = 3_000;

interface SearchRow {
  symbol: string;
  name: string;
  exchangeShortName: string | null;
}

interface SearchResultItem {
  symbol: string;
  companyName: string;
  sector: string;
  domain: string | null;
  marketCap: number | null;
}

interface SP500SearchItem {
  symbol: string;
  companyName: string;
  sector: string;
}

const searchResponseCache = new Map<string, { expiresAt: number; results: SearchResultItem[] }>();

function fmpApiKey(): string | null {
  const key = (process.env.FMP_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function boundedLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "12", 10);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(parsed, 20));
}

async function fetchFmp<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = fmpApiKey();
  if (!key) return null;

  const url = new URL(`${FMP_STABLE_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  setUrlSearchParams(url, {
    apikey: key,
    ...params
  });

  return fetchJsonOrNull<T>(url, {
    timeoutMs: SEARCH_FETCH_TIMEOUT_MS,
    revalidateSeconds: 180,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });
}

function normalizeSearchRows(payload: unknown): SearchRow[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const rows: SearchRow[] = [];

  for (const raw of payload) {
    if (typeof raw !== "object" || raw === null) continue;

    const record = raw as Record<string, unknown>;
    const symbol = sanitizeSymbol(asString(record.symbol) ?? "");
    const name = asString(record.name) ?? symbol;
    const exchangeShortName = asString(record.exchangeShortName);

    if (!symbol) continue;

    rows.push({ symbol, name, exchangeShortName });
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.symbol)) return false;
    seen.add(row.symbol);
    return true;
  });
}

function rankSearchRows(rows: SearchRow[], query: string): SearchRow[] {
  const qUpper = query.toUpperCase();
  const qLower = query.toLowerCase();

  return [...rows].sort((a, b) => {
    const score = (row: SearchRow): number => {
      let value = 0;
      const symbol = row.symbol;
      const name = row.name.toLowerCase();

      if (symbol === qUpper) value += 100;
      else if (symbol.startsWith(qUpper)) value += 60;
      else if (symbol.includes(qUpper)) value += 30;

      if (name.startsWith(qLower)) value += 25;
      else if (name.includes(qLower)) value += 10;

      if (row.exchangeShortName === "NASDAQ" || row.exchangeShortName === "NYSE") {
        value += 5;
      }

      return value;
    };

    return score(b) - score(a);
  });
}

function rankSP500Items(items: SP500SearchItem[], query: string): SP500SearchItem[] {
  const qUpper = query.toUpperCase();
  const qLower = query.toLowerCase();

  return [...items].sort((a, b) => {
    const score = (item: SP500SearchItem): number => {
      let value = 0;
      const symbol = item.symbol;
      const name = item.companyName.toLowerCase();

      if (symbol === qUpper) value += 120;
      else if (symbol.startsWith(qUpper)) value += 80;
      else if (symbol.includes(qUpper)) value += 35;

      if (name === qLower) value += 50;
      else if (name.startsWith(qLower)) value += 30;
      else if (name.includes(qLower)) value += 15;

      return value;
    };

    return score(b) - score(a);
  });
}

function dedupeBySymbol(results: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  const deduped: SearchResultItem[] = [];

  for (const item of results) {
    if (seen.has(item.symbol)) {
      continue;
    }

    seen.add(item.symbol);
    deduped.push(item);
  }

  return deduped;
}

function fallbackResults(
  query: string,
  limit: number,
  sp500Directory: Record<string, SP500SearchItem>,
  sp500SectorMap: Record<string, string>,
  allowedSymbols: Set<string>
): SearchResultItem[] {
  const qUpper = query.toUpperCase();
  const qLower = query.toLowerCase();

  const directoryItems = Object.values(sp500Directory);
  if (directoryItems.length > 0) {
    return rankSP500Items(directoryItems, query)
      .filter((item) => item.symbol.includes(qUpper) || item.companyName.toLowerCase().includes(qLower))
      .slice(0, limit)
      .map((item) => ({
        symbol: item.symbol,
        companyName: item.companyName,
        sector: item.sector,
        domain: resolveDomainForTicker(item.symbol),
        marketCap: null
      }));
  }

  return Array.from(allowedSymbols)
    .filter((symbol) => symbol.includes(qUpper))
    .slice(0, limit)
    .map((symbol) => ({
      symbol,
      companyName: symbol,
      sector: sp500SectorMap[symbol] ?? "Other",
      domain: resolveDomainForTicker(symbol),
      marketCap: null
    }));
}

function cloneResults(results: SearchResultItem[]): SearchResultItem[] {
  return results.map((item) => ({ ...item }));
}

function getCachedResults(cacheKey: string): SearchResultItem[] | null {
  const cached = searchResponseCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchResponseCache.delete(cacheKey);
    return null;
  }
  return cloneResults(cached.results);
}

function setCachedResults(cacheKey: string, results: SearchResultItem[]): void {
  if (searchResponseCache.size > 300) {
    searchResponseCache.clear();
  }

  searchResponseCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    results: cloneResults(results)
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-search",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim();
    const limit = boundedLimit(url.searchParams.get("limit"));

    if (query.length === 0) {
      return NextResponse.json({ results: [] }, { headers: { "Cache-Control": SEARCH_CACHE_HEADER } });
    }

    const cacheKey = `${query.toUpperCase()}|${limit}`;
    const cached = getCachedResults(cacheKey);
    if (cached) {
      return NextResponse.json({ results: cached }, { headers: { "Cache-Control": SEARCH_CACHE_HEADER } });
    }

    const top100Symbols = getTop100Sp500SymbolSet();
    const sp500Directory = await fetchSP500Directory();
    const directoryItems = Object.values(sp500Directory);
    const sp500SectorMap = directoryItems.length >= 450 ? {} : await fetchSP500SectorMap();

    const allowedSymbols = new Set<string>(
      [...top100Symbols].filter((symbol) =>
        directoryItems.length >= 450 ? Boolean(sp500Directory[symbol]) : Boolean(sp500SectorMap[symbol]) || top100Symbols.has(symbol)
      )
    );

    const qUpper = query.toUpperCase();
    const qLower = query.toLowerCase();

    if (directoryItems.length >= 450) {
      const ranked = rankSP500Items(directoryItems, query)
        .filter((item) => allowedSymbols.has(item.symbol))
        .filter((item) => item.symbol.includes(qUpper) || item.companyName.toLowerCase().includes(qLower))
        .slice(0, limit)
        .map((item) => ({
          symbol: item.symbol,
          companyName: item.companyName,
          sector: item.sector,
          domain: resolveDomainForTicker(item.symbol),
          marketCap: null
        }));

      if (ranked.length > 0) {
        const fastResults = dedupeBySymbol(ranked);
        setCachedResults(cacheKey, fastResults);
        return NextResponse.json({ results: fastResults }, { headers: { "Cache-Control": SEARCH_CACHE_HEADER } });
      }
    }

    const searchPayload = await fetchFmp<unknown>("/search-symbol", { query });
    const rows = rankSearchRows(normalizeSearchRows(searchPayload), query)
      .filter((row) => allowedSymbols.has(row.symbol))
      .slice(0, limit);

    if (rows.length === 0) {
      const fallback = dedupeBySymbol(fallbackResults(query, limit, sp500Directory, sp500SectorMap, allowedSymbols));
      setCachedResults(cacheKey, fallback);
      return NextResponse.json(
        {
          results: fallback
        },
        { headers: { "Cache-Control": SEARCH_CACHE_HEADER } }
      );
    }

    const enriched = rows.map((row) => {
      const canonical = sp500Directory[row.symbol];
      const companyName = canonical?.companyName ?? row.name ?? row.symbol;
      const sector = canonical?.sector ?? resolveSectorFromCandidates([sp500SectorMap[row.symbol]]);
      const domain = resolveDomainForTicker(row.symbol);

      const item: SearchResultItem = {
        symbol: row.symbol,
        companyName,
        sector,
        domain,
        marketCap: null
      };

      return item;
    });

    const results = dedupeBySymbol(enriched);
    setCachedResults(cacheKey, results);
    return NextResponse.json({ results }, { headers: { "Cache-Control": SEARCH_CACHE_HEADER } });
  } catch (error) {
    console.error("/api/search GET error", error);
    return NextResponse.json({ error: "Search failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
