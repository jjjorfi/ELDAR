import { AdapterError, defaultProvenance, toISODate, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkChangePct, checkPrice } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { TradierQuoteRaw } from "@/lib/normalize/types/providers";

export function normalizeTradier(raw: TradierQuoteRaw, fetchedAt: string): CanonicalQuote {
  const ticker = toUpperTicker(raw.symbol);

  const priceCheck = checkPrice(raw.last, { ticker });
  if (!priceCheck.ok || priceCheck.value == null) {
    throw new AdapterError(`Tradier ${ticker}: price failed sanity (${priceCheck.reason ?? "unknown"})`);
  }

  if (!Number.isFinite(raw.prevclose) || raw.prevclose <= 0) {
    throw new AdapterError(`Tradier ${ticker}: prevclose missing/invalid`);
  }

  const changePct = Number.isFinite(raw.change_percentage) ? raw.change_percentage / 100 : null;

  return {
    ticker,
    exchange: raw.exch ?? null,
    price: priceCheck.value,
    open: Number.isFinite(raw.open ?? null) ? (raw.open ?? null) : null,
    high: Number.isFinite(raw.high ?? null) ? (raw.high ?? null) : null,
    low: Number.isFinite(raw.low ?? null) ? (raw.low ?? null) : null,
    prevClose: raw.prevclose,
    change: Number.isFinite(raw.change) ? raw.change : priceCheck.value - raw.prevclose,
    changePct: checkChangePct(changePct).value ?? (priceCheck.value - raw.prevclose) / raw.prevclose,
    volume: Number.isFinite(raw.volume ?? null) ? (raw.volume ?? null) : null,
    avgVolume: Number.isFinite(raw.average_volume ?? null) ? (raw.average_volume ?? null) : null,
    marketCap: null,
    sharesOut: null,
    marketState: "regular",
    timestamp: toISODate(raw.trade_date ?? null) ?? fetchedAt,
    meta: defaultProvenance("tradier", fetchedAt)
  };
}
