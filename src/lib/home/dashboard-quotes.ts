import { getFetchSignal } from "@/lib/market/adapter-utils";
import { fetchAlphaVantageQuoteSnapshot } from "@/lib/market/alpha-vantage";
import { fetchEodhdQuoteSnapshot } from "@/lib/market/eodhd";
import { fetchFinnhubQuoteSnapshot } from "@/lib/market/finnhub";
import { fetchFmpQuoteSnapshot } from "@/lib/market/fmp";
import { fetchTemporaryQuoteFallback } from "@/lib/market/temporary-fallbacks";

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const LOG_TTL_MS = 60_000;
const recentWarnings = new Map<string, number>();
const YAHOO_BATCH_DISABLE_TTL_MS = 10 * 60_000;
let yahooBatchDisabledUntil = 0;

export interface QuoteRow {
  symbol: string;
  regularMarketPrice: number | null;
  regularMarketChangePercent: number | null;
  asOfMs: number | null;
}

function warnOnce(scope: string, message: string): void {
  const key = `${scope}:${message}`;
  const now = Date.now();
  const previous = recentWarnings.get(key) ?? 0;
  if (now - previous < LOG_TTL_MS) {
    return;
  }
  recentWarnings.set(key, now);
  console.warn(`[Dashboard Quotes][${scope}]: ${message}`);
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asIsoDateFromYmd(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = Date.parse(`${trimmed}T21:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function asIsoDateFromYmdWithTime(rawDate: string, rawTime: string): number | null {
  const date = rawDate.trim();
  const time = rawTime.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return asIsoDateFromYmd(date);
  const parsed = Date.parse(`${date}T${time}Z`);
  return Number.isFinite(parsed) ? parsed : asIsoDateFromYmd(date);
}

function asIsoDateFromMdy(raw: string): number | null {
  const trimmed = raw.trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const parsed = Date.parse(`${yyyy}-${mm}-${dd}T21:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchQuotes(symbols: string[]): Promise<Map<string, QuoteRow>> {
  if (Date.now() < yahooBatchDisabledUntil) {
    return new Map();
  }

  const chunks: string[][] = [];
  const deduped = Array.from(new Set(symbols.map((value) => value.trim().toUpperCase()).filter(Boolean)));
  for (let index = 0; index < deduped.length; index += 75) {
    chunks.push(deduped.slice(index, index + 75));
  }

  const map = new Map<string, QuoteRow>();

  await Promise.all(
    chunks.map(async (group) => {
      if (group.length === 0) return;
      const url = new URL(YAHOO_QUOTE_URL);
      url.searchParams.set("symbols", group.join(","));

      try {
        const response = await fetch(url.toString(), {
          cache: "no-store",
          signal: getFetchSignal(3500),
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0"
          }
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            yahooBatchDisabledUntil = Date.now() + YAHOO_BATCH_DISABLE_TTL_MS;
          }
          warnOnce("yahoo-batch", `quote batch failed (${response.status}) for ${group.join(",")}`);
          return;
        }

        const payload = (await response.json()) as {
          quoteResponse?: {
            result?: Array<Record<string, unknown>>;
          };
        };

        const rows = Array.isArray(payload.quoteResponse?.result) ? payload.quoteResponse?.result : [];
        for (const row of rows) {
          const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
          if (!symbol) continue;
          map.set(symbol, {
            symbol,
            regularMarketPrice: safeNumber(row.regularMarketPrice),
            regularMarketChangePercent: safeNumber(row.regularMarketChangePercent),
            asOfMs: (() => {
              const ts = safeNumber(row.regularMarketTime);
              return ts !== null ? Math.round(ts * 1000) : null;
            })()
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Yahoo quote batch error.";
        warnOnce("yahoo-batch", `${message} for ${group.join(",")}`);
      }
    })
  );

  return map;
}

async function fetchProviderFallbackQuote(symbol: string): Promise<QuoteRow | null> {
  // Temporary patch: free-tier quote bridges keep the dashboard responsive until
  // premium provider quotas/entitlements are upgraded.
  const [finnhub, fmp, eodhd, alpha, temporary] = await Promise.all([
    fetchFinnhubQuoteSnapshot(symbol),
    fetchFmpQuoteSnapshot(symbol),
    fetchEodhdQuoteSnapshot(symbol),
    fetchAlphaVantageQuoteSnapshot(symbol),
    fetchTemporaryQuoteFallback(symbol)
  ]);

  const price = finnhub.price ?? fmp.price ?? eodhd.price ?? alpha.price ?? temporary.price ?? null;
  const asOfMs = finnhub.asOfMs ?? fmp.asOfMs ?? eodhd.asOfMs ?? alpha.asOfMs ?? temporary.asOfMs ?? null;
  const changePercent = finnhub.changePercent ?? temporary.changePercent ?? null;

  if (price === null && changePercent === null) return null;

  return {
    symbol: symbol.toUpperCase(),
    regularMarketPrice: price,
    regularMarketChangePercent: changePercent,
    asOfMs
  };
}

async function fetchYahooChartQuote(symbol: string): Promise<QuoteRow | null> {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("range", "5d");

    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: getFetchSignal(3_500),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      warnOnce("yahoo-chart", `${symbol} failed (${response.status})`);
      return null;
    }

    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            symbol?: string;
            regularMarketPrice?: number;
            regularMarketTime?: number;
          };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const result = payload.chart?.result?.[0];
    if (!result) return null;

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closesRaw = result.indicators?.quote?.[0]?.close ?? [];
    const closes = closesRaw.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    const latestClose = closes[closes.length - 1] ?? safeNumber(result.meta?.regularMarketPrice) ?? null;
    if (latestClose === null) return null;

    const previousClose = closes.length >= 2 ? closes[closes.length - 2] : null;
    const changePercent =
      previousClose !== null && previousClose !== 0
        ? ((latestClose - previousClose) / Math.abs(previousClose)) * 100
        : null;

    const latestTsSeconds =
      timestamps.length > 0 && Number.isFinite(timestamps[timestamps.length - 1] as number)
        ? (timestamps[timestamps.length - 1] as number)
        : safeNumber(result.meta?.regularMarketTime);
    const asOfMs = latestTsSeconds !== null ? Math.round(latestTsSeconds * 1000) : null;

    return {
      symbol: (result.meta?.symbol ?? symbol).toUpperCase(),
      regularMarketPrice: latestClose,
      regularMarketChangePercent: changePercent,
      asOfMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo chart quote error.";
    warnOnce("yahoo-chart", `${symbol} ${message}`);
    return null;
  }
}

function toStooqSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper === "^GSPC") return "^SPX";
  if (upper === "^NDX") return "^NDX";
  if (upper === "^RUT") return "IWM.US";
  if (upper === "^VIX") return "VIX";
  if (upper === "DX-Y.NYB" || upper === "DX=F") return "DX.F";
  if (upper === "CL=F") return "CL.F";
  if (upper.endsWith(".US") || upper.endsWith(".F")) return upper;
  if (upper.startsWith("^")) return upper;
  const normalized = upper.replace(/\./g, "-");
  return `${normalized}.US`;
}

async function fetchStooqQuote(symbol: string): Promise<QuoteRow | null> {
  const stooqSymbol = toStooqSymbol(symbol).toLowerCase();
  const fetchCsvWithRetry = async (url: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: getFetchSignal(attempt === 0 ? 4500 : 6500),
          headers: {
            Accept: "text/csv",
            "User-Agent": "Mozilla/5.0"
          }
        });
        if (!response.ok) {
          if (attempt === 2) {
            warnOnce("stooq", `${symbol} live/history failed (${response.status})`);
            return null;
          }
          await new Promise((resolve) => setTimeout(resolve, 160 * (attempt + 1)));
          continue;
        }
        return await response.text();
      } catch (error) {
        if (attempt === 2) {
          const message = error instanceof Error ? error.message : "Unknown Stooq error.";
          warnOnce("stooq", `${symbol} ${message}`);
          return null;
        }
        await new Promise((resolve) => setTimeout(resolve, 160 * (attempt + 1)));
      }
    }
    return null;
  };

  try {
    const liveUrl = new URL("https://stooq.com/q/l/");
    liveUrl.searchParams.set("s", stooqSymbol);
    liveUrl.searchParams.set("f", "sd2t2ohlcv");
    liveUrl.searchParams.set("h", "");
    liveUrl.searchParams.set("e", "csv");
    const liveCsv = await fetchCsvWithRetry(liveUrl.toString());
    if (liveCsv) {
      const dataLine = liveCsv
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("Symbol"));
      if (dataLine) {
        const fields = dataLine.split(",");
        if (fields.length >= 8) {
          const asOfMs = asIsoDateFromYmdWithTime(fields[1], fields[2]);
          const open = safeNumber(fields[3]);
          const close = safeNumber(fields[6]);
          if (close !== null) {
            return {
              symbol: symbol.toUpperCase(),
              regularMarketPrice: close,
              regularMarketChangePercent:
                open !== null && open !== 0
                  ? ((close - open) / Math.abs(open)) * 100
                  : null,
              asOfMs
            };
          }
        }
      }
    }

    const historyUrl = new URL("https://stooq.com/q/d/l/");
    historyUrl.searchParams.set("s", stooqSymbol);
    historyUrl.searchParams.set("i", "d");
    const historyCsv = await fetchCsvWithRetry(historyUrl.toString());
    if (!historyCsv) return null;

    const lines = historyCsv
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("Date"));

    let latestClose: number | null = null;
    let previousClose: number | null = null;
    let asOfMs: number | null = null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const fields = lines[index].split(",");
      if (fields.length < 5) continue;
      const close = safeNumber(fields[4]);
      if (close === null) continue;
      if (latestClose === null) {
        latestClose = close;
        asOfMs = asIsoDateFromYmd(fields[0]);
      } else {
        previousClose = close;
        break;
      }
    }

    if (latestClose === null) return null;
    return {
      symbol: symbol.toUpperCase(),
      regularMarketPrice: latestClose,
      regularMarketChangePercent:
        previousClose !== null && previousClose !== 0
          ? ((latestClose - previousClose) / Math.abs(previousClose)) * 100
          : null,
      asOfMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stooq parse error.";
    warnOnce("stooq", `${symbol} ${message}`);
    return null;
  }
}

async function fetchFredTenYearYieldQuote(): Promise<QuoteRow | null> {
  try {
    const response = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", {
      cache: "no-store",
      signal: getFetchSignal(3500),
      headers: {
        Accept: "text/csv",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) {
      warnOnce("fred", `DGS10 failed (${response.status})`);
      return null;
    }
    const csv = await response.text();
    const rows = csv
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("DATE"));

    const points: Array<{ value: number; asOfMs: number | null }> = [];
    for (const row of rows) {
      const fields = row.split(",");
      if (fields.length < 2) continue;
      const value = safeNumber(fields[1]);
      if (value === null) continue;
      points.push({ value, asOfMs: asIsoDateFromYmd(fields[0]) });
    }
    if (points.length === 0) return null;

    const latest = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : null;
    const changePercent = previous && previous.value !== 0
      ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
      : null;

    return {
      symbol: "^TNX",
      regularMarketPrice: latest.value,
      regularMarketChangePercent: changePercent,
      asOfMs: latest.asOfMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown FRED error.";
    warnOnce("fred", message);
    return null;
  }
}

async function fetchCboeVixQuote(): Promise<QuoteRow | null> {
  try {
    const response = await fetch("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv", {
      cache: "no-store",
      signal: getFetchSignal(3500),
      headers: {
        Accept: "text/csv",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) {
      warnOnce("cboe", `VIX failed (${response.status})`);
      return null;
    }
    const csv = await response.text();
    const rows = csv
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("DATE"));

    const points: Array<{ close: number; asOfMs: number | null }> = [];
    for (const row of rows) {
      const fields = row.split(",");
      if (fields.length < 5) continue;
      const close = safeNumber(fields[4]);
      if (close === null) continue;
      points.push({ close, asOfMs: asIsoDateFromMdy(fields[0]) });
    }
    if (points.length === 0) return null;

    const latest = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : null;

    return {
      symbol: "^VIX",
      regularMarketPrice: latest.close,
      regularMarketChangePercent:
        previous && previous.close !== 0
          ? ((latest.close - previous.close) / Math.abs(previous.close)) * 100
          : null,
      asOfMs: latest.asOfMs
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CBOE error.";
    warnOnce("cboe", message);
    return null;
  }
}

function mergeQuoteRows(primary: QuoteRow | null, secondary: QuoteRow | null, symbol: string): QuoteRow | null {
  if (!primary && !secondary) return null;
  return {
    symbol: symbol.toUpperCase(),
    regularMarketPrice: primary?.regularMarketPrice ?? secondary?.regularMarketPrice ?? null,
    regularMarketChangePercent: primary?.regularMarketChangePercent ?? secondary?.regularMarketChangePercent ?? null,
    asOfMs: primary?.asOfMs ?? secondary?.asOfMs ?? null
  };
}

async function enrichMissingQuotes(quoteMap: Map<string, QuoteRow>, symbols: string[]): Promise<Map<string, QuoteRow>> {
  const enriched = new Map(quoteMap);
  const uniqueSymbols = Array.from(new Set(symbols.map((value) => value.trim().toUpperCase()).filter(Boolean)));
  const storeQuote = (symbol: string, row: QuoteRow): void => {
    enriched.set(symbol, row);
    enriched.set(toYahooSymbol(symbol), row);
  };

  for (let index = 0; index < uniqueSymbols.length; index += 12) {
    const batch = uniqueSymbols.slice(index, index + 12);
    await Promise.all(batch.map(async (symbol) => {
      const existing = quoteValue(enriched, symbol, toYahooSymbol(symbol));
      if (existing?.regularMarketPrice != null && existing?.regularMarketChangePercent != null) {
        return;
      }

      const chartMerged = await fetchYahooChartQuote(symbol);
      const afterChart = mergeQuoteRows(existing ?? null, chartMerged, symbol);
      if (afterChart?.regularMarketPrice != null && afterChart?.regularMarketChangePercent != null) {
        storeQuote(symbol, afterChart);
        return;
      }

      let fredMerged: QuoteRow | null = null;
      if (symbol.toUpperCase() === "^TNX" && (afterChart?.regularMarketPrice == null || afterChart?.regularMarketChangePercent == null)) {
        fredMerged = await fetchFredTenYearYieldQuote();
      }

      let vixMerged: QuoteRow | null = null;
      if (symbol.toUpperCase() === "^VIX" && (afterChart?.regularMarketPrice == null || afterChart?.regularMarketChangePercent == null)) {
        vixMerged = await fetchCboeVixQuote();
      }

      const afterSpecialized = mergeQuoteRows(afterChart, mergeQuoteRows(fredMerged, vixMerged, symbol), symbol);
      if (afterSpecialized?.regularMarketPrice != null && afterSpecialized?.regularMarketChangePercent != null) {
        storeQuote(symbol, afterSpecialized);
        return;
      }

      const [stooqMerged, providerMerged] = await Promise.all([
        fetchStooqQuote(symbol),
        (
          (fredMerged?.regularMarketPrice == null || fredMerged?.regularMarketChangePercent == null) &&
          (vixMerged?.regularMarketPrice == null || vixMerged?.regularMarketChangePercent == null)
        )
          ? fetchProviderFallbackQuote(symbol)
          : Promise.resolve<QuoteRow | null>(null)
      ]);

      const afterStooq = mergeQuoteRows(afterSpecialized, stooqMerged, symbol);
      const merged = mergeQuoteRows(afterStooq, mergeQuoteRows(fredMerged, vixMerged, symbol), symbol);
      const finalQuote = mergeQuoteRows(merged, providerMerged, symbol);
      if (!finalQuote) {
        warnOnce("fallback-exhausted", `${symbol} has no usable quote from fallback chain`);
        return;
      }

      storeQuote(symbol, finalQuote);
    }));
  }

  return enriched;
}

export function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-").toUpperCase();
}

export function quoteValue(
  map: Map<string, QuoteRow>,
  primary: string,
  fallback?: string
): QuoteRow | null {
  const first = map.get(primary.toUpperCase());
  if (first) return first;
  const yahooVariant = map.get(toYahooSymbol(primary));
  if (yahooVariant) return yahooVariant;
  if (!fallback) return null;
  return map.get(fallback.toUpperCase()) ?? map.get(toYahooSymbol(fallback)) ?? null;
}

export async function fetchDashboardQuoteMap(coreSymbols: string[], moverSymbols: string[]): Promise<Map<string, QuoteRow>> {
  const moverYahooSymbols = moverSymbols.map((symbol) => toYahooSymbol(symbol));
  const symbols = Array.from(new Set([...coreSymbols, ...moverYahooSymbols]));

  const rawQuoteMap = await fetchQuotes(symbols);
  const coreQuoteMap = await enrichMissingQuotes(rawQuoteMap, coreSymbols);
  const quoteMap = await enrichMissingQuotes(coreQuoteMap, moverSymbols);

  const [fredTenYear, cboeVix] = await Promise.all([
    fetchFredTenYearYieldQuote(),
    fetchCboeVixQuote()
  ]);

  if (fredTenYear) {
    const existing = quoteValue(quoteMap, "^TNX");
    const merged = mergeQuoteRows(existing ?? null, fredTenYear, "^TNX");
    if (merged) {
      quoteMap.set("^TNX", merged);
    }
  }

  if (cboeVix) {
    const existing = quoteValue(quoteMap, "^VIX");
    const merged = mergeQuoteRows(existing ?? null, cboeVix, "^VIX");
    if (merged) {
      quoteMap.set("^VIX", merged);
    }
  }

  return quoteMap;
}
