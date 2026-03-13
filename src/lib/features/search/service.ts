import { resolveDomainForTicker } from "@/lib/branding/ticker-domain";
import { log } from "@/lib/logger";
import { fetchSP500Directory, fetchSP500SectorMap } from "@/lib/market/universe/sp500";
import { resolveSectorFromCandidates } from "@/lib/scoring/sector/config";

const SEARCH_CACHE_TTL_MS = 90_000;
export const SEARCH_CACHE_HEADER = "public, max-age=15, s-maxage=60, stale-while-revalidate=120";

export interface SearchResultItem {
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

interface SearchServiceSuccess {
  ok: true;
  status: 200;
  results: SearchResultItem[];
  cacheControl: string;
}

interface SearchServiceFailure {
  ok: false;
  status: 500;
  error: string;
  cacheControl: string;
}

export type SearchServiceResult = SearchServiceSuccess | SearchServiceFailure;

const searchResponseCache = new Map<string, { expiresAt: number; results: SearchResultItem[] }>();

function boundedLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "12", 10);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(parsed, 20));
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
    if (seen.has(item.symbol)) continue;
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

export async function searchSymbols(queryRaw: string, limitRaw: string | null): Promise<SearchServiceResult> {
  try {
    const query = (queryRaw ?? "").trim();
    const limit = boundedLimit(limitRaw);

    if (query.length === 0) {
      return {
        ok: true,
        status: 200,
        results: [],
        cacheControl: SEARCH_CACHE_HEADER
      };
    }

    const cacheKey = `${query.toUpperCase()}|${limit}`;
    const cached = getCachedResults(cacheKey);
    if (cached) {
      return {
        ok: true,
        status: 200,
        results: cached,
        cacheControl: SEARCH_CACHE_HEADER
      };
    }

    const sp500Directory = await fetchSP500Directory();
    const directoryItems = Object.values(sp500Directory);
    const sp500SectorMap = directoryItems.length >= 450 ? {} : await fetchSP500SectorMap();

    const allowedSymbols = new Set<string>(
      directoryItems.length > 0 ? directoryItems.map((item) => item.symbol) : Object.keys(sp500SectorMap)
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
        return {
          ok: true,
          status: 200,
          results: fastResults,
          cacheControl: SEARCH_CACHE_HEADER
        };
      }
    }

    const results = dedupeBySymbol(fallbackResults(query, limit, sp500Directory, sp500SectorMap, allowedSymbols));
    setCachedResults(cacheKey, results);
    return {
      ok: true,
      status: 200,
      results,
      cacheControl: SEARCH_CACHE_HEADER
    };
  } catch (error) {
    log({
      level: "error",
      service: "search-service",
      message: "Search failed",
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      status: 500,
      error: "Search failed.",
      cacheControl: "no-store"
    };
  }
}
