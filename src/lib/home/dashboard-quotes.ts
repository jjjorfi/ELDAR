import { getFetchSignal } from "@/lib/market/adapter-utils";
import { fetchAlphaVantageQuoteSnapshot } from "@/lib/market/providers/alpha-vantage";
import { fetchEodhdQuoteSnapshot } from "@/lib/market/providers/eodhd";
import { env } from "@/lib/env";
import { fetchFinnhubQuoteSnapshot } from "@/lib/market/providers/finnhub";
import { fetchFmpQuoteSnapshot } from "@/lib/market/providers/fmp";
import { log } from "@/lib/logger";
import { fetchTemporaryQuoteFallback } from "@/lib/market/orchestration/temporary-fallbacks";

const LOG_TTL_MS = 60_000;
const recentWarnings = new Map<string, number>();
const PROVIDER_QUOTE_TIMEOUT_MS = 900;
const YAHOO_CHART_TIMEOUT_MS = 1_200;
const SPECIAL_FEED_TIMEOUT_MS = 1_400;
const QUOTE_MAP_CACHE_TTL_MS = 3_000;
const ENABLE_STOOQ_FALLBACK = false;
const quoteMapCache = new Map<string, { expiresAt: number; map: Map<string, QuoteRow> }>();
const quoteMapInFlight = new Map<string, Promise<Map<string, QuoteRow>>>();

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
  log({
    level: "warn",
    service: "dashboard-quotes",
    message,
    scope
  });
}

function infoOnce(scope: string, message: string): void {
  const key = `info:${scope}:${message}`;
  const now = Date.now();
  const previous = recentWarnings.get(key) ?? 0;
  if (now - previous < LOG_TTL_MS) {
    return;
  }
  recentWarnings.set(key, now);
  log({
    level: "info",
    service: "dashboard-quotes",
    message,
    scope
  });
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

function withProviderTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, PROVIDER_QUOTE_TIMEOUT_MS);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

interface ProviderFallbackQuoteResult {
  row: QuoteRow | null;
  source: string | null;
}

interface QuoteResolutionStats {
  totalSymbols: number;
  yahooChart: number;
  fred: number;
  cboe: number;
  providerFallback: number;
  providerFallbackBySource: Map<string, number>;
  stooq: number;
  missing: number;
}

function createQuoteResolutionStats(totalSymbols: number): QuoteResolutionStats {
  return {
    totalSymbols,
    yahooChart: 0,
    fred: 0,
    cboe: 0,
    providerFallback: 0,
    providerFallbackBySource: new Map<string, number>(),
    stooq: 0,
    missing: 0
  };
}

function incrementProviderFallbackSource(stats: QuoteResolutionStats, source: string | null): void {
  if (!source) return;
  const current = stats.providerFallbackBySource.get(source) ?? 0;
  stats.providerFallbackBySource.set(source, current + 1);
}

function logQuoteResolutionStats(scope: string, stats: QuoteResolutionStats): void {
  if (stats.totalSymbols === 0) return;
  const providerSummary = Array.from(stats.providerFallbackBySource.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([source, count]) => `${source}:${count}`)
    .join(", ");
  const parts = [
    `symbols=${stats.totalSymbols}`,
    `yahooChart=${stats.yahooChart}`,
    `fred=${stats.fred}`,
    `cboe=${stats.cboe}`,
    `providerFallback=${stats.providerFallback}`,
    `stooq=${stats.stooq}`,
    `missing=${stats.missing}`
  ];
  if (providerSummary.length > 0) {
    parts.push(`providerSources=${providerSummary}`);
  }
  const fallbackRatio = (stats.providerFallback + stats.stooq + stats.missing) / stats.totalSymbols;
  const message = parts.join(" ");
  if (fallbackRatio >= 0.25 || stats.missing > 0) {
    warnOnce(scope, message);
    return;
  }
  infoOnce(scope, message);
}

async function fetchProviderFallbackQuote(symbol: string): Promise<ProviderFallbackQuoteResult> {
  // Temporary patch: free-tier quote bridges keep the dashboard responsive until
  // premium provider quotas/entitlements are upgraded.
  // Keep this staged to avoid redundant provider calls and excessive latency:
  // - Stage 1: Finnhub + temporary bridge (which already ranks Alpaca/Twelve/Google/Marketstack/Alpha).
  // - Stage 2: legacy direct adapters only when stage 1 is still empty.
  const [finnhub, bridge] = await Promise.all([
    withProviderTimeout(fetchFinnhubQuoteSnapshot(symbol), { price: null, changePercent: null, asOfMs: null }),
    withProviderTimeout(fetchTemporaryQuoteFallback(symbol), {
      price: null,
      changePercent: null,
      asOfMs: null,
      source: null
    })
  ]);

  const stageOnePrice = finnhub.price ?? bridge.price ?? null;
  const stageOneAsOfMs = finnhub.asOfMs ?? bridge.asOfMs ?? null;
  const stageOneChangePercent = finnhub.changePercent ?? bridge.changePercent ?? null;
  if (stageOnePrice !== null || stageOneChangePercent !== null) {
    return {
      row: {
        symbol: symbol.toUpperCase(),
        regularMarketPrice: stageOnePrice,
        regularMarketChangePercent: stageOneChangePercent,
        asOfMs: stageOneAsOfMs
      },
      source:
        finnhub.price !== null || finnhub.changePercent !== null
          ? "FINNHUB"
          : bridge.source ?? "TEMPORARY"
    };
  }

  const [fmp, eodhd, alpha] = await Promise.all([
    withProviderTimeout(fetchFmpQuoteSnapshot(symbol), { price: null, asOfMs: null }),
    withProviderTimeout(fetchEodhdQuoteSnapshot(symbol), { price: null, asOfMs: null }),
    withProviderTimeout(fetchAlphaVantageQuoteSnapshot(symbol), { price: null, asOfMs: null })
  ]);

  const price = fmp.price ?? eodhd.price ?? alpha.price ?? null;
  const asOfMs = fmp.asOfMs ?? eodhd.asOfMs ?? alpha.asOfMs ?? null;
  const changePercent = null;

  if (price === null && changePercent === null) {
    return {
      row: null,
      source: null
    };
  }

  return {
    row: {
      symbol: symbol.toUpperCase(),
      regularMarketPrice: price,
      regularMarketChangePercent: changePercent,
      asOfMs
    },
    source:
      fmp.price !== null
        ? "FMP"
        : eodhd.price !== null
          ? "EODHD"
          : alpha.price !== null
            ? "ALPHA_VANTAGE"
            : null
  };
}

async function fetchYahooChartQuote(symbol: string): Promise<QuoteRow | null> {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("range", "5d");

    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: getFetchSignal(YAHOO_CHART_TIMEOUT_MS),
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

async function fetchPreferredYahooChartQuote(symbol: string): Promise<QuoteRow | null> {
  const normalized = symbol.trim().toUpperCase();
  const candidates =
    normalized === "DX-Y.NYB"
      ? ["DX-Y.NYB", "DX=F"]
      : [normalized];

  for (const candidate of candidates) {
    const row = await fetchYahooChartQuote(candidate);
    if (!row) continue;
    return {
      ...row,
      symbol: normalized
    };
  }

  return null;
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
  const apiKey = env.FRED_API_KEY;

  if (apiKey) {
    try {
      const apiUrl = new URL("https://api.stlouisfed.org/fred/series/observations");
      apiUrl.searchParams.set("series_id", "DGS10");
      apiUrl.searchParams.set("api_key", apiKey);
      apiUrl.searchParams.set("file_type", "json");
      apiUrl.searchParams.set("sort_order", "desc");
      apiUrl.searchParams.set("limit", "45");

      const response = await fetch(apiUrl.toString(), {
        cache: "no-store",
        signal: getFetchSignal(SPECIAL_FEED_TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          "User-Agent": "ELDAR/1.0"
        }
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          observations?: Array<{
            date?: string;
            value?: string;
          }>;
        };
        const points = (payload.observations ?? [])
          .map((row) => {
            const value = safeNumber(row.value ?? null);
            const asOfMs = typeof row.date === "string" ? asIsoDateFromYmd(row.date) : null;
            if (value === null) return null;
            return { value, asOfMs };
          })
          .filter((row): row is { value: number; asOfMs: number | null } => row !== null)
          .sort((left, right) => (left.asOfMs ?? 0) - (right.asOfMs ?? 0));

        if (points.length > 0) {
          const latest = points[points.length - 1];
          const previous = points.length > 1 ? points[points.length - 2] : null;
          return {
            symbol: "^TNX",
            regularMarketPrice: latest.value,
            regularMarketChangePercent:
              previous && previous.value !== 0
                ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
                : null,
            asOfMs: latest.asOfMs
          };
        }
      } else {
        warnOnce("fred", `DGS10 api failed (${response.status})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown FRED API error.";
      warnOnce("fred", `DGS10 api ${message}`);
    }
  }

  try {
    const response = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", {
      cache: "no-store",
      signal: getFetchSignal(SPECIAL_FEED_TIMEOUT_MS),
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
      signal: getFetchSignal(SPECIAL_FEED_TIMEOUT_MS),
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

async function enrichMissingQuotes(
  quoteMap: Map<string, QuoteRow>,
  symbols: string[],
  stats: QuoteResolutionStats
): Promise<Map<string, QuoteRow>> {
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
      const isTenYear = symbol === "^TNX";
      const isVix = symbol === "^VIX";
      let fredMerged: QuoteRow | null = isTenYear ? await fetchFredTenYearYieldQuote() : null;
      let vixMerged: QuoteRow | null = isVix ? await fetchCboeVixQuote() : null;

      const specializedFirst = mergeQuoteRows(existing ?? null, mergeQuoteRows(fredMerged, vixMerged, symbol), symbol);
      if (specializedFirst?.regularMarketPrice != null && specializedFirst?.regularMarketChangePercent != null) {
        if (fredMerged?.regularMarketPrice != null || fredMerged?.regularMarketChangePercent != null) {
          stats.fred += 1;
        } else if (vixMerged?.regularMarketPrice != null || vixMerged?.regularMarketChangePercent != null) {
          stats.cboe += 1;
        }
        storeQuote(symbol, specializedFirst);
        return;
      }

      if (existing?.regularMarketPrice != null && existing?.regularMarketChangePercent != null) {
        return;
      }

      const chartMerged = await fetchPreferredYahooChartQuote(symbol);
      const afterChart = mergeQuoteRows(existing ?? null, chartMerged, symbol);
      if (afterChart?.regularMarketPrice != null && afterChart?.regularMarketChangePercent != null) {
        stats.yahooChart += 1;
        storeQuote(symbol, afterChart);
        return;
      }

      if (fredMerged === null && isTenYear && (afterChart?.regularMarketPrice == null || afterChart?.regularMarketChangePercent == null)) {
        fredMerged = await fetchFredTenYearYieldQuote();
      }

      if (vixMerged === null && isVix && (afterChart?.regularMarketPrice == null || afterChart?.regularMarketChangePercent == null)) {
        vixMerged = await fetchCboeVixQuote();
      }

      const afterSpecialized = mergeQuoteRows(afterChart, mergeQuoteRows(fredMerged, vixMerged, symbol), symbol);
      if (afterSpecialized?.regularMarketPrice != null && afterSpecialized?.regularMarketChangePercent != null) {
        if (fredMerged?.regularMarketPrice != null || fredMerged?.regularMarketChangePercent != null) {
          stats.fred += 1;
        } else if (vixMerged?.regularMarketPrice != null || vixMerged?.regularMarketChangePercent != null) {
          stats.cboe += 1;
        }
        storeQuote(symbol, afterSpecialized);
        return;
      }

      const providerResolved = (
        (fredMerged?.regularMarketPrice == null || fredMerged?.regularMarketChangePercent == null) &&
        (vixMerged?.regularMarketPrice == null || vixMerged?.regularMarketChangePercent == null)
      )
        ? await fetchProviderFallbackQuote(symbol)
        : { row: null, source: null };

      const stooqMerged = ENABLE_STOOQ_FALLBACK ? await fetchStooqQuote(symbol) : null;
      const merged = mergeQuoteRows(afterSpecialized, mergeQuoteRows(fredMerged, vixMerged, symbol), symbol);
      const withProvider = mergeQuoteRows(merged, providerResolved.row, symbol);
      const finalQuote = mergeQuoteRows(withProvider, stooqMerged, symbol);
      if (!finalQuote) {
        stats.missing += 1;
        warnOnce("fallback-exhausted", `${symbol} has no usable quote from fallback chain`);
        return;
      }

      if (providerResolved.row && (merged?.regularMarketPrice == null || merged?.regularMarketChangePercent == null)) {
        stats.providerFallback += 1;
        incrementProviderFallbackSource(stats, providerResolved.source);
      } else if (stooqMerged) {
        stats.stooq += 1;
      }

      storeQuote(symbol, finalQuote);
    }));
  }

  return enriched;
}

export function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-").toUpperCase();
}

function normalizeSymbolList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)));
}

function quoteMapCacheKey(coreSymbols: string[], moverSymbols: string[]): string {
  const core = normalizeSymbolList(coreSymbols).sort().join(",");
  const movers = normalizeSymbolList(moverSymbols).sort().join(",");
  return `${core}|${movers}`;
}

function cloneQuoteMap(source: Map<string, QuoteRow>): Map<string, QuoteRow> {
  return new Map(source);
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
  const normalizedCore = normalizeSymbolList(coreSymbols);
  const normalizedMovers = normalizeSymbolList(moverSymbols);
  const cacheKey = quoteMapCacheKey(normalizedCore, normalizedMovers);
  const cached = quoteMapCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneQuoteMap(cached.map);
  }

  let inFlight = quoteMapInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = (async () => {
      const symbols = Array.from(new Set([...normalizedCore, ...normalizedMovers]));
      const stats = createQuoteResolutionStats(symbols.length);

      const rawQuoteMap = new Map<string, QuoteRow>();
      const coreQuoteMap = await enrichMissingQuotes(rawQuoteMap, normalizedCore, stats);
      const quoteMap = normalizedMovers.length > 0
        ? await enrichMissingQuotes(coreQuoteMap, normalizedMovers, stats)
        : coreQuoteMap;

      const needsTenYear = (() => {
        const row = quoteValue(quoteMap, "^TNX");
        return row?.regularMarketPrice == null || row?.regularMarketChangePercent == null;
      })();
      const needsVix = (() => {
        const row = quoteValue(quoteMap, "^VIX");
        return row?.regularMarketPrice == null || row?.regularMarketChangePercent == null;
      })();

      const [fredTenYear, cboeVix] = await Promise.all([
        needsTenYear ? fetchFredTenYearYieldQuote() : Promise.resolve<QuoteRow | null>(null),
        needsVix ? fetchCboeVixQuote() : Promise.resolve<QuoteRow | null>(null)
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

      quoteMapCache.set(cacheKey, {
        expiresAt: Date.now() + QUOTE_MAP_CACHE_TTL_MS,
        map: cloneQuoteMap(quoteMap)
      });

      logQuoteResolutionStats("map-build", stats);

      return quoteMap;
    })().finally(() => {
      quoteMapInFlight.delete(cacheKey);
    });

    quoteMapInFlight.set(cacheKey, inFlight);
  }

  const resolved = await inFlight;
  return cloneQuoteMap(resolved);
}
