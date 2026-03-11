import { fetchTemporaryQuoteFallback } from "@/lib/market/orchestration/temporary-fallbacks";
import { sanitizeSymbol } from "@/lib/utils";

import type { LiveQuotePayload, LiveQuoteRow } from "@/lib/features/price/types";

const MAX_SYMBOLS = 24;
const LIVE_ROUTE_CACHE_TTL_MS = 1_000;

const liveRouteCache = new Map<string, { expiresAt: number; payload: LiveQuotePayload }>();
const liveRouteInFlight = new Map<string, Promise<LiveQuotePayload>>();

interface QuickQuoteRow extends LiveQuoteRow {}

export function parseLiveQuoteSymbols(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => sanitizeSymbol(value))
        .filter((value) => value.length > 0)
    )
  ).slice(0, MAX_SYMBOLS);
}

function liveRouteCacheKey(symbols: string[]): string {
  return symbols.map((symbol) => symbol.toUpperCase()).sort().join(",");
}

async function buildLiveQuotePayload(symbols: string[]): Promise<LiveQuotePayload> {
  const quickRows = await Promise.all(
    symbols.map(async (symbol): Promise<QuickQuoteRow> => {
      const snapshot = await fetchTemporaryQuoteFallback(symbol, { fast: true });
      return {
        symbol,
        price: snapshot.price,
        changePercent: snapshot.changePercent,
        asOfMs: snapshot.asOfMs
      };
    })
  );

  const quickMap = new Map(quickRows.map((row) => [row.symbol, row]));
  const quotes: LiveQuoteRow[] = symbols.map((symbol) => {
    const fast = quickMap.get(symbol);
    return {
      symbol,
      price: fast?.price ?? null,
      changePercent: fast?.changePercent ?? null,
      asOfMs: fast?.asOfMs ?? null
    };
  });

  return {
    quotes,
    source: "HTTP_POLL",
    fetchedAt: new Date().toISOString()
  };
}

export async function getLiveQuotePayloadCached(
  symbols: string[]
): Promise<{ payload: LiveQuotePayload; cache: "memory" | "in-flight" | "computed" }> {
  const key = liveRouteCacheKey(symbols);
  const now = Date.now();
  const cached = liveRouteCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { payload: cached.payload, cache: "memory" };
  }

  let inFlight = liveRouteInFlight.get(key);
  const hadInFlight = Boolean(inFlight);
  if (!inFlight) {
    inFlight = buildLiveQuotePayload(symbols).finally(() => {
      liveRouteInFlight.delete(key);
    });
    liveRouteInFlight.set(key, inFlight);
  }

  const payload = await inFlight;
  liveRouteCache.set(key, {
    expiresAt: Date.now() + LIVE_ROUTE_CACHE_TTL_MS,
    payload
  });

  return {
    payload,
    cache: hadInFlight ? "in-flight" : "computed"
  };
}
