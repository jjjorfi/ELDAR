import { buildCanonicalQuote } from "@/lib/normalize/adapters/_utils";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { AlpacaSnapshotRaw } from "@/lib/normalize/types/providers";

/**
 * Normalizes an Alpaca snapshot into ELDAR's canonical quote shape.
 *
 * @param raw Raw Alpaca snapshot payload.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical quote payload.
 */
export function normalizeAlpaca(raw: AlpacaSnapshotRaw, fetchedAt: string): CanonicalQuote {
  return buildCanonicalQuote({
    source: "alpaca",
    adapterLabel: "Alpaca",
    tickerInput: raw.symbol,
    fetchedAt,
    exchange: null,
    price: raw.latestTrade?.p ?? raw.minuteBar?.c ?? raw.dailyBar?.c ?? null,
    prevClose: raw.prevDailyBar?.c ?? null,
    open: raw.dailyBar?.o ?? null,
    high: raw.dailyBar?.h ?? null,
    low: raw.dailyBar?.l ?? null,
    volume: raw.dailyBar?.v ?? raw.minuteBar?.v ?? null,
    avgVolume: null,
    marketCap: null,
    sharesOut: null,
    marketState: "regular",
    timestamp: raw.latestTrade?.t ?? raw.dailyBar?.t ?? null
  });
}
