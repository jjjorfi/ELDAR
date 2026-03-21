import { buildCanonicalQuote } from "@/lib/normalize/adapters/_utils";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { TradierQuoteRaw } from "@/lib/normalize/types/providers";

/**
 * Normalizes a Tradier quote payload into ELDAR's canonical quote shape.
 *
 * @param raw Raw Tradier quote payload.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical quote payload.
 */
export function normalizeTradier(raw: TradierQuoteRaw, fetchedAt: string): CanonicalQuote {
  return buildCanonicalQuote({
    source: "tradier",
    adapterLabel: "Tradier",
    tickerInput: raw.symbol,
    fetchedAt,
    exchange: raw.exch ?? null,
    price: raw.last,
    prevClose: raw.prevclose,
    rawChange: Number.isFinite(raw.change) ? raw.change : null,
    rawChangePct: Number.isFinite(raw.change_percentage) ? raw.change_percentage : null,
    rawChangePctScale: "percent",
    open: Number.isFinite(raw.open ?? null) ? (raw.open ?? null) : null,
    high: Number.isFinite(raw.high ?? null) ? (raw.high ?? null) : null,
    low: Number.isFinite(raw.low ?? null) ? (raw.low ?? null) : null,
    volume: Number.isFinite(raw.volume ?? null) ? (raw.volume ?? null) : null,
    avgVolume: Number.isFinite(raw.average_volume ?? null) ? (raw.average_volume ?? null) : null,
    marketCap: null,
    sharesOut: null,
    marketState: "regular",
    timestamp: raw.trade_date ?? null,
    prevCloseFieldLabel: "prevclose"
  });
}
