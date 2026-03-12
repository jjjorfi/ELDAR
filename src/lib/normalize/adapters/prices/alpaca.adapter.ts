import { AdapterError, defaultProvenance, toISODate, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkChangePct, checkPrice } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { AlpacaSnapshotRaw } from "@/lib/normalize/types/providers";

export function normalizeAlpaca(raw: AlpacaSnapshotRaw, fetchedAt: string): CanonicalQuote {
  const ticker = toUpperTicker(raw.symbol);
  const price = raw.latestTrade?.p ?? raw.minuteBar?.c ?? raw.dailyBar?.c ?? null;
  const prevClose = raw.prevDailyBar?.c ?? null;

  if (prevClose == null || !Number.isFinite(prevClose) || prevClose <= 0) {
    throw new AdapterError(`Alpaca ${ticker}: prevClose missing/invalid`);
  }

  const priceCheck = checkPrice(price, { ticker });
  if (!priceCheck.ok || priceCheck.value == null) {
    throw new AdapterError(`Alpaca ${ticker}: price failed sanity (${priceCheck.reason ?? "unknown"})`);
  }

  const change = priceCheck.value - prevClose;
  const changePct = prevClose !== 0 ? change / prevClose : 0;
  const safeChangePct = checkChangePct(changePct).value ?? 0;

  return {
    ticker,
    exchange: null,
    price: priceCheck.value,
    open: raw.dailyBar?.o ?? null,
    high: raw.dailyBar?.h ?? null,
    low: raw.dailyBar?.l ?? null,
    prevClose,
    change,
    changePct: safeChangePct,
    volume: raw.dailyBar?.v ?? raw.minuteBar?.v ?? null,
    avgVolume: null,
    marketCap: null,
    sharesOut: null,
    marketState: "regular",
    timestamp: toISODate(raw.latestTrade?.t ?? raw.dailyBar?.t ?? null) ?? fetchedAt,
    meta: defaultProvenance("alpaca", fetchedAt)
  };
}
