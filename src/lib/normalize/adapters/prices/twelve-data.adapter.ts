import {
  buildCanonicalQuote,
  parseFloatOrNull,
  parseIntOrNull
} from "@/lib/normalize/adapters/_utils";
import { checkChangePct } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { TwelveDataQuoteRaw } from "@/lib/normalize/types/providers";

/**
 * Normalizes a Twelve Data quote payload into ELDAR's canonical quote shape.
 *
 * @param raw Raw Twelve Data quote payload.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical quote payload.
 */
export function normalizeTwelveData(raw: TwelveDataQuoteRaw, fetchedAt: string): CanonicalQuote {
  const warnings: string[] = [];
  const rawPct = parseFloatOrNull(raw.percent_change);
  const changePctCheck = checkChangePct(rawPct != null ? rawPct / 100 : null);
  if (!changePctCheck.ok) {
    warnings.push(`changePct: ${changePctCheck.reason ?? "invalid"}`);
  }

  return buildCanonicalQuote({
    source: "twelve_data",
    adapterLabel: "TwelveData",
    tickerInput: raw.symbol,
    fetchedAt,
    exchange: raw.exchange ?? null,
    price: parseFloatOrNull(raw.close),
    prevClose: parseFloatOrNull(raw.previous_close),
    rawChange: parseFloatOrNull(raw.change),
    rawChangePct: rawPct,
    rawChangePctScale: "percent",
    open: parseFloatOrNull(raw.open),
    high: parseFloatOrNull(raw.high),
    low: parseFloatOrNull(raw.low),
    volume: parseIntOrNull(raw.volume),
    avgVolume: null,
    marketCap: null,
    sharesOut: null,
    marketState: raw.is_market_open ? "regular" : "closed",
    timestamp: raw.timestamp ?? raw.datetime ?? null,
    provenance: {
      delayMins: 15,
      warnings
    }
  });
}
