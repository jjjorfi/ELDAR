// This file centralizes temporary free-tier quote/history fallback policy. It is
// intentionally a bridge layer while the project is still building on limited
// provider quotas, and it should be easy to remove once premium data is live.
// Gotcha: do not add new fundamentals logic here; this layer is only for quote
// and time-series continuity so the UI stays responsive during the build phase.

import { fetchAlphaVantageDailyHistory, fetchAlphaVantageQuoteSnapshot } from "@/lib/market/providers/alpha-vantage";
import { fetchAlpacaDailyHistory, fetchAlpacaQuoteSnapshot } from "@/lib/market/providers/alpaca";
import { fetchGoogleFinanceQuoteSnapshot } from "@/lib/market/providers/google-finance";
import { fetchMarketstackDailyHistory, fetchMarketstackQuoteSnapshot } from "@/lib/market/providers/marketstack";
import { fetchTwelveDataDailyHistory, fetchTwelveDataQuoteSnapshot } from "@/lib/market/providers/twelvedata";

type QuoteSource = "ALPACA" | "TWELVEDATA" | "GOOGLE_FINANCE" | "MARKETSTACK" | "ALPHA_VANTAGE";
type HistorySource = "ALPACA" | "TWELVEDATA" | "MARKETSTACK" | "ALPHA_VANTAGE";

export interface TemporaryQuoteFallback {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
  source: QuoteSource | null;
}

export interface TemporaryHistoryFallback {
  points: Array<{ date: Date; close: number | null }>;
  source: HistorySource | null;
}

interface TemporaryHistoryOptions {
  range: string;
  interval: string;
  minimumPoints?: number;
}

const QUOTE_PROVIDER_TIMEOUT_MS = 700;
const HISTORY_PROVIDER_TIMEOUT_MS = 1_200;
const QUOTE_CACHE_TTL_MS = 2_000;
const HISTORY_CACHE_TTL_MS = 30_000;

const quoteFallbackCache = new Map<string, { expiresAt: number; value: TemporaryQuoteFallback }>();
const quoteFallbackInFlight = new Map<string, Promise<TemporaryQuoteFallback>>();
const historyFallbackCache = new Map<string, { expiresAt: number; value: TemporaryHistoryFallback }>();
const historyFallbackInFlight = new Map<string, Promise<TemporaryHistoryFallback>>();

interface QuoteSnapshotLike {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

function emptyQuote(source: QuoteSource | null = null): TemporaryQuoteFallback {
  return {
    price: null,
    changePercent: null,
    asOfMs: null,
    source
  };
}

function emptyQuoteSnapshot(): QuoteSnapshotLike {
  return {
    price: null,
    changePercent: null,
    asOfMs: null
  };
}

function emptyHistory(source: HistorySource | null = null): TemporaryHistoryFallback {
  return {
    points: [],
    source
  };
}

function copyQuote(value: TemporaryQuoteFallback): TemporaryQuoteFallback {
  return {
    price: value.price,
    changePercent: value.changePercent,
    asOfMs: value.asOfMs,
    source: value.source
  };
}

function copyHistory(value: TemporaryHistoryFallback): TemporaryHistoryFallback {
  return {
    points: value.points.slice(),
    source: value.source
  };
}

function withSoftTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, Math.max(150, timeoutMs));

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

async function firstAvailableQuote(
  providers: Array<{
    source: QuoteSource;
    fetch: () => Promise<QuoteSnapshotLike>;
  }>
): Promise<TemporaryQuoteFallback | null> {
  if (providers.length === 0) return null;

  return new Promise((resolve) => {
    let settled = false;
    let pending = providers.length;

    for (const provider of providers) {
      void provider
        .fetch()
        .then((snapshot) => {
          if (settled) return;
          if (snapshot.price !== null) {
            settled = true;
            resolve({
              price: snapshot.price,
              changePercent: snapshot.changePercent,
              asOfMs: snapshot.asOfMs,
              source: provider.source
            });
            return;
          }
          pending -= 1;
          if (pending === 0) {
            settled = true;
            resolve(null);
          }
        })
        .catch(() => {
          if (settled) return;
          pending -= 1;
          if (pending === 0) {
            settled = true;
            resolve(null);
          }
        });
    }
  });
}

async function firstHistoryMeetingMinimum(
  providers: Array<{
    source: HistorySource;
    promise: Promise<Array<{ date: Date; close: number | null }>>;
  }>,
  minimumPoints: number,
  interval: string
): Promise<TemporaryHistoryFallback | null> {
  if (providers.length === 0) return null;

  return new Promise((resolve) => {
    let settled = false;
    let pending = providers.length;

    for (const provider of providers) {
      void provider.promise
        .then((rawPoints) => {
          if (settled) return;
          const points = normalizeIntervalPoints(rawPoints, interval);
          if (points.length >= minimumPoints) {
            settled = true;
            resolve({
              points,
              source: provider.source
            });
            return;
          }
          pending -= 1;
          if (pending === 0) {
            settled = true;
            resolve(null);
          }
        })
        .catch(() => {
          if (settled) return;
          pending -= 1;
          if (pending === 0) {
            settled = true;
            resolve(null);
          }
        });
    }
  });
}

function toMonthlyHistory(points: Array<{ date: Date; close: number | null }>): Array<{ date: Date; close: number | null }> {
  const buckets = new Map<string, { date: Date; close: number | null }>();

  for (const point of points) {
    if (point.close === null) continue;
    const key = `${point.date.getUTCFullYear()}-${String(point.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = buckets.get(key);
    if (!existing || point.date > existing.date) {
      buckets.set(key, point);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => +a.date - +b.date);
}

function fallbackTargetDays(range: string, interval: string): number {
  if (interval === "1mo" && range === "12y") return 365 * 12;
  if (range === "5d") return 10;
  if (range === "1mo") return 40;
  if (range === "3mo") return 120;
  if (range === "6mo") return 220;
  if (range === "1y") return 366;
  if (range === "2y") return 730;
  if (range === "12y") return 365 * 12;
  return 366;
}

function defaultMinimumPoints(range: string, interval: string): number {
  if (interval === "1mo") return range === "12y" ? 110 : 12;
  if (range === "5d") return 2;
  if (range === "1mo") return 15;
  if (range === "3mo") return 45;
  if (range === "6mo") return 110;
  if (range === "1y") return 220;
  if (range === "2y") return 220;
  return 100;
}

function normalizeIntervalPoints(
  points: Array<{ date: Date; close: number | null }>,
  interval: string
): Array<{ date: Date; close: number | null }> {
  if (interval === "1mo") {
    return toMonthlyHistory(points);
  }
  return points;
}

export async function fetchTemporaryQuoteFallback(
  symbol: string,
  options: { fast?: boolean } = {}
): Promise<TemporaryQuoteFallback> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const now = Date.now();
  const cached = quoteFallbackCache.get(normalizedSymbol);
  if (cached && cached.expiresAt > now) {
    return copyQuote(cached.value);
  }

  const running = quoteFallbackInFlight.get(normalizedSymbol);
  if (running) {
    return copyQuote(await running);
  }

  // Ranked temporary quote fallback order:
  // 1. Alpaca snapshots: best real-time continuity among free-tier bridge paths.
  // 2. Twelve Data: official API, good quote ergonomics.
  // 3. Google Finance: fresh page data, but unofficial scraping -> lower trust.
  // 4. marketstack: slower and EOD-oriented, but still more usable than Alpha here.
  // 5. Alpha Vantage: currently the weakest quote bridge in live testing.
  const run = (async (): Promise<TemporaryQuoteFallback> => {
    const firstTier = await firstAvailableQuote([
      {
        source: "ALPACA",
        fetch: () =>
          withSoftTimeout(
            fetchAlpacaQuoteSnapshot(normalizedSymbol),
            QUOTE_PROVIDER_TIMEOUT_MS,
            emptyQuoteSnapshot()
          )
      },
      {
        source: "TWELVEDATA",
        fetch: () =>
          withSoftTimeout(
            fetchTwelveDataQuoteSnapshot(normalizedSymbol),
            QUOTE_PROVIDER_TIMEOUT_MS,
            emptyQuoteSnapshot()
          )
      }
    ]);
    if (firstTier || options.fast) return firstTier ?? emptyQuote();

    const secondTier = await firstAvailableQuote([
      {
        source: "GOOGLE_FINANCE",
        fetch: () =>
          withSoftTimeout(
            fetchGoogleFinanceQuoteSnapshot(normalizedSymbol).then((snapshot) => ({
              price: snapshot.price,
              changePercent: snapshot.changePercent,
              asOfMs: snapshot.asOfMs
            })),
            QUOTE_PROVIDER_TIMEOUT_MS,
            emptyQuoteSnapshot()
          )
      },
      {
        source: "MARKETSTACK",
        fetch: () =>
          withSoftTimeout(
            fetchMarketstackQuoteSnapshot(normalizedSymbol),
            QUOTE_PROVIDER_TIMEOUT_MS,
            emptyQuoteSnapshot()
          )
      },
      {
        source: "ALPHA_VANTAGE",
        fetch: () =>
          withSoftTimeout(
            fetchAlphaVantageQuoteSnapshot(normalizedSymbol).then((snapshot) => ({
              price: snapshot.price,
              changePercent: null,
              asOfMs: snapshot.asOfMs
            })),
            QUOTE_PROVIDER_TIMEOUT_MS,
            emptyQuoteSnapshot()
          )
      }
    ]);

    return secondTier ?? emptyQuote();
  })();

  quoteFallbackInFlight.set(normalizedSymbol, run);
  try {
    const result = await run;
    quoteFallbackCache.set(normalizedSymbol, {
      value: copyQuote(result),
      expiresAt: Date.now() + QUOTE_CACHE_TTL_MS
    });
    return copyQuote(result);
  } finally {
    quoteFallbackInFlight.delete(normalizedSymbol);
  }
}

export async function fetchTemporaryHistoryFallback(
  symbol: string,
  options: TemporaryHistoryOptions
): Promise<TemporaryHistoryFallback> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  // Ranked temporary history fallback order:
  // 1. Alpaca daily bars
  // 2. Twelve Data daily series
  // 3. marketstack EOD history when window is short enough
  // 4. Alpha Vantage daily adjusted as the last official bridge
  const minimumPoints = options.minimumPoints ?? defaultMinimumPoints(options.range, options.interval);
  const targetDays = fallbackTargetDays(options.range, options.interval);
  const cacheKey = `${normalizedSymbol}|${options.range}|${options.interval}|${minimumPoints}`;
  const cached = historyFallbackCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return copyHistory(cached.value);
  }

  const running = historyFallbackInFlight.get(cacheKey);
  if (running) {
    return copyHistory(await running);
  }

  const run = (async (): Promise<TemporaryHistoryFallback> => {
    let best: TemporaryHistoryFallback = emptyHistory();

    const tierOneProviders = [
      {
        source: "ALPACA" as const,
        promise: withSoftTimeout(
          fetchAlpacaDailyHistory(normalizedSymbol, targetDays + 40),
          HISTORY_PROVIDER_TIMEOUT_MS,
          []
        )
      },
      {
        source: "TWELVEDATA" as const,
        promise: withSoftTimeout(
          fetchTwelveDataDailyHistory(normalizedSymbol, targetDays + 40),
          HISTORY_PROVIDER_TIMEOUT_MS,
          []
        )
      }
    ];

    const tierOneFast = await firstHistoryMeetingMinimum(tierOneProviders, minimumPoints, options.interval);
    if (tierOneFast) {
      return tierOneFast;
    }

    const [alpacaHistoryRaw, twelveDataHistoryRaw] = await Promise.all(
      tierOneProviders.map((provider) => provider.promise)
    );

    const alpacaPoints = normalizeIntervalPoints(alpacaHistoryRaw, options.interval);
    if (alpacaPoints.length >= minimumPoints) {
      return { points: alpacaPoints, source: "ALPACA" };
    }
    if (alpacaPoints.length > best.points.length) {
      best = { points: alpacaPoints, source: "ALPACA" };
    }

    const twelveDataPoints = normalizeIntervalPoints(twelveDataHistoryRaw, options.interval);
    if (twelveDataPoints.length >= minimumPoints) {
      return { points: twelveDataPoints, source: "TWELVEDATA" };
    }
    if (twelveDataPoints.length > best.points.length) {
      best = { points: twelveDataPoints, source: "TWELVEDATA" };
    }

    const tierTwoProviders = [
      {
        source: "MARKETSTACK" as const,
        promise:
          targetDays <= 366
            ? withSoftTimeout(
                fetchMarketstackDailyHistory(normalizedSymbol, targetDays + 10),
                HISTORY_PROVIDER_TIMEOUT_MS,
                []
              )
            : Promise.resolve([])
      },
      {
        source: "ALPHA_VANTAGE" as const,
        promise: withSoftTimeout(fetchAlphaVantageDailyHistory(normalizedSymbol), HISTORY_PROVIDER_TIMEOUT_MS, [])
      }
    ];

    const tierTwoFast = await firstHistoryMeetingMinimum(tierTwoProviders, minimumPoints, options.interval);
    if (tierTwoFast) {
      return tierTwoFast;
    }

    const [marketstackHistoryRaw, alphaHistoryRaw] = await Promise.all(
      tierTwoProviders.map((provider) => provider.promise)
    );

    const marketstackPoints = normalizeIntervalPoints(marketstackHistoryRaw, options.interval);
    if (marketstackPoints.length >= minimumPoints) {
      return { points: marketstackPoints, source: "MARKETSTACK" };
    }
    if (marketstackPoints.length > best.points.length) {
      best = { points: marketstackPoints, source: "MARKETSTACK" };
    }

    const alphaPoints = normalizeIntervalPoints(alphaHistoryRaw, options.interval);
    if (alphaPoints.length >= minimumPoints) {
      return { points: alphaPoints, source: "ALPHA_VANTAGE" };
    }
    if (alphaPoints.length > best.points.length) {
      best = { points: alphaPoints, source: "ALPHA_VANTAGE" };
    }

    return best;
  })();

  historyFallbackInFlight.set(cacheKey, run);
  try {
    const result = await run;
    historyFallbackCache.set(cacheKey, {
      value: copyHistory(result),
      expiresAt: Date.now() + HISTORY_CACHE_TTL_MS
    });
    return copyHistory(result);
  } finally {
    historyFallbackInFlight.delete(cacheKey);
  }
}
