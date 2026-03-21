import { buildCanonicalQuote } from "@/lib/normalize/adapters/_utils";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { FinnhubQuoteRaw } from "@/lib/normalize/types/providers";

/**
 * Normalizes a Finnhub quote payload into ELDAR's canonical quote shape.
 *
 * @param raw Raw Finnhub quote payload.
 * @param tickerInput Caller-supplied ticker symbol used for provenance.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical quote payload.
 */
export function normalizeFinnhub(raw: FinnhubQuoteRaw, tickerInput: string, fetchedAt: string): CanonicalQuote {
  return buildCanonicalQuote({
    source: "finnhub",
    adapterLabel: "Finnhub",
    tickerInput,
    fetchedAt,
    exchange: null,
    price: raw.c,
    prevClose: Number.isFinite(raw.pc) && raw.pc > 0 ? raw.pc : null,
    rawChange: Number.isFinite(raw.d) ? raw.d : null,
    rawChangePct: Number.isFinite(raw.dp) ? raw.dp : null,
    rawChangePctScale: "percent",
    open: Number.isFinite(raw.o) ? raw.o : null,
    high: Number.isFinite(raw.h) ? raw.h : null,
    low: Number.isFinite(raw.l) ? raw.l : null,
    volume: null,
    avgVolume: null,
    marketCap: null,
    sharesOut: null,
    marketState: "unknown",
    timestamp: raw.t
  });
}
