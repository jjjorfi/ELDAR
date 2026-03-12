import {
  AdapterError,
  defaultProvenance,
  parseFloatOrNull,
  parseIntOrNull,
  toISODate,
  toUpperTicker
} from "@/lib/normalize/adapters/_utils";
import { checkChangePct, checkPrice } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalQuote } from "@/lib/normalize/types/canonical";
import type { TwelveDataQuoteRaw } from "@/lib/normalize/types/providers";

export function normalizeTwelveData(raw: TwelveDataQuoteRaw, fetchedAt: string): CanonicalQuote {
  const ticker = toUpperTicker(raw.symbol);
  const price = parseFloatOrNull(raw.close);
  const prevClose = parseFloatOrNull(raw.previous_close);

  if (prevClose == null || prevClose <= 0) {
    throw new AdapterError(`TwelveData ${ticker}: prevClose missing/invalid`);
  }

  const priceCheck = checkPrice(price, { ticker });
  if (!priceCheck.ok || priceCheck.value == null) {
    throw new AdapterError(`TwelveData ${ticker}: price failed sanity (${priceCheck.reason ?? "unknown"})`);
  }

  const warnings: string[] = [];
  const rawPct = parseFloatOrNull(raw.percent_change);
  const parsedPct = rawPct != null ? rawPct / 100 : (priceCheck.value - prevClose) / prevClose;
  const changePctCheck = checkChangePct(parsedPct);
  if (!changePctCheck.ok) {
    warnings.push(`changePct: ${changePctCheck.reason ?? "invalid"}`);
  }

  const parsedTimestamp =
    toISODate(raw.timestamp ?? null) ??
    toISODate(raw.datetime ?? null) ??
    fetchedAt;

  return {
    ticker,
    exchange: raw.exchange ?? null,
    price: priceCheck.value,
    open: parseFloatOrNull(raw.open),
    high: parseFloatOrNull(raw.high),
    low: parseFloatOrNull(raw.low),
    prevClose,
    change: parseFloatOrNull(raw.change) ?? (priceCheck.value - prevClose),
    changePct: changePctCheck.value ?? 0,
    volume: parseIntOrNull(raw.volume),
    avgVolume: null,
    marketCap: null,
    sharesOut: null,
    marketState: raw.is_market_open ? "regular" : "closed",
    timestamp: parsedTimestamp,
    meta: defaultProvenance("twelve_data", fetchedAt, {
      delayMins: 15,
      warnings
    })
  };
}
