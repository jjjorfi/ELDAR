import { AdapterError, defaultProvenance, toISODate, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkChangePct, checkPrice } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { FinnhubQuoteRaw } from "@/lib/normalize/types/providers";

export function normalizeFinnhub(raw: FinnhubQuoteRaw, tickerInput: string, fetchedAt: string): CanonicalQuote {
  const ticker = toUpperTicker(tickerInput);

  const priceCheck = checkPrice(raw.c, { ticker });
  if (!priceCheck.ok || priceCheck.value == null) {
    throw new AdapterError(`Finnhub ${ticker}: price failed sanity (${priceCheck.reason ?? "unknown"})`);
  }

  const prevClose = Number.isFinite(raw.pc) && raw.pc > 0 ? raw.pc : null;
  if (prevClose == null) {
    throw new AdapterError(`Finnhub ${ticker}: prevClose missing/invalid`);
  }

  const dpDecimal = Number.isFinite(raw.dp) ? raw.dp / 100 : null;
  const safeChangePct = checkChangePct(dpDecimal).value ?? (priceCheck.value - prevClose) / prevClose;

  return {
    ticker,
    exchange: null,
    price: priceCheck.value,
    open: Number.isFinite(raw.o) ? raw.o : null,
    high: Number.isFinite(raw.h) ? raw.h : null,
    low: Number.isFinite(raw.l) ? raw.l : null,
    prevClose,
    change: Number.isFinite(raw.d) ? raw.d : priceCheck.value - prevClose,
    changePct: safeChangePct,
    volume: null,
    avgVolume: null,
    marketCap: null,
    sharesOut: null,
    marketState: "unknown",
    timestamp: toISODate(raw.t) ?? fetchedAt,
    meta: defaultProvenance("finnhub", fetchedAt)
  };
}
