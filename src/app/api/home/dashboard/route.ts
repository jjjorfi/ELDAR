import { NextResponse } from "next/server";

import { getFetchSignal } from "@/lib/market/adapter-utils";
import { fetchAlphaVantageQuoteSnapshot } from "@/lib/market/alpha-vantage";
import { fetchEodhdQuoteSnapshot } from "@/lib/market/eodhd";
import { fetchFinnhubQuoteSnapshot } from "@/lib/market/finnhub";
import { fetchFmpQuoteSnapshot } from "@/lib/market/fmp";
import {
  DEFAULT_SECTOR_WINDOW,
  fetchSectorPerformance,
  type SectorPerformanceWindow
} from "@/lib/market/sector-performance";
import { runRouteGuards } from "@/lib/api/route-security";
import { normalizeSectorName } from "@/lib/scoring/sector-config";
import { getRecentAnalyses } from "@/lib/storage";
import type { PersistedAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const CACHE_TTL_MS = 90_000;

type Tone = "positive" | "neutral" | "negative";
type SectorRotationWindow = SectorPerformanceWindow;

interface QuoteRow {
  symbol: string;
  regularMarketPrice: number | null;
  regularMarketChangePercent: number | null;
  asOfMs: number | null;
}

interface RegimeMetric {
  key: "tenYearYield" | "vix" | "dxy" | "oil";
  label: string;
  value: number | null;
  changePercent: number | null;
}

interface SnapshotItem {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
}

interface MarketMoverItem {
  symbol: string;
  companyName: string;
  currentPrice: number | null;
  changePercent: number;
}

interface SectorRotationItem {
  etf: string;
  name: string;
  performancePercent: number | null;
  signalScore: number | null;
  signalStrength: "STRONG" | "CONSTRUCTIVE" | "NEUTRAL" | "WEAK" | "UNAVAILABLE";
}

interface BaseDashboardPayload {
  generatedAt: string;
  sectorWindow: SectorRotationWindow;
  regime: {
    label: "RISK_ON" | "BALANCED" | "RISK_OFF";
    summary: string;
    metrics: RegimeMetric[];
  };
  snapshot: SnapshotItem[];
  marketMovers: MarketMoverItem[];
  sectorRotation: SectorRotationItem[];
}

const SECTOR_CONFIG: Array<{ etf: string; name: string; sector: string }> = [
  { etf: "XLK", name: "Information Tech", sector: "Information Technology" },
  { etf: "XLF", name: "Financials", sector: "Financials" },
  { etf: "XLV", name: "Health Care", sector: "Health Care" },
  { etf: "XLY", name: "Consumer Discretionary", sector: "Consumer Discretionary" },
  { etf: "XLC", name: "Communication Services", sector: "Communication Services" },
  { etf: "XLI", name: "Industrials", sector: "Industrials" },
  { etf: "XLP", name: "Consumer Staples", sector: "Consumer Staples" },
  { etf: "XLE", name: "Energy", sector: "Energy" },
  { etf: "XLU", name: "Utilities", sector: "Utilities" },
  { etf: "XLRE", name: "Real Estate", sector: "Real Estate" },
  { etf: "XLB", name: "Materials", sector: "Materials" }
];

const FALLBACK_MOVER_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "JPM", "XOM", "LLY", "AVGO", "COST"];

let baseCacheByWindow = new Map<SectorRotationWindow, { expiresAt: number; payload: BaseDashboardPayload }>();
let basePayloadInFlightByWindow = new Map<SectorRotationWindow, Promise<BaseDashboardPayload>>();

function parseSectorWindow(raw: string | null): SectorRotationWindow {
  const value = (raw ?? "").trim().toUpperCase();
  if (value === "1M" || value === "3M" || value === "6M" || value === "YTD") {
    return value;
  }
  return DEFAULT_SECTOR_WINDOW;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function yieldFromQuote(value: number | null): number | null {
  if (value === null) return null;
  if (value > 20) return value / 10;
  return value;
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

function percentTone(value: number | null): Tone {
  if (value === null) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function buildRegimeLabel(vix: number | null, dxyChange: number | null, oilChange: number | null): BaseDashboardPayload["regime"]["label"] {
  if (typeof vix === "number" && vix >= 24) return "RISK_OFF";
  if (typeof vix === "number" && vix <= 16 && (dxyChange ?? 0) <= 0.2) return "RISK_ON";
  if ((dxyChange ?? 0) > 0.6 && (oilChange ?? 0) < -1) return "RISK_OFF";
  return "BALANCED";
}

function buildRegimeSummary(label: BaseDashboardPayload["regime"]["label"], metrics: RegimeMetric[]): string {
  const vix = metrics.find((metric) => metric.key === "vix")?.value;
  const dxyTone = percentTone(metrics.find((metric) => metric.key === "dxy")?.changePercent ?? null);
  const oilTone = percentTone(metrics.find((metric) => metric.key === "oil")?.changePercent ?? null);

  if (label === "RISK_ON") {
    return `Volatility is contained${typeof vix === "number" ? ` (VIX ${vix.toFixed(1)})` : ""}, with improving risk appetite.`;
  }
  if (label === "RISK_OFF") {
    return `Defensive posture: volatility and dollar strength are pressuring risk assets.`;
  }
  if (dxyTone === "positive" && oilTone === "negative") {
    return "Cross-asset signals are mixed with a defensive tilt.";
  }
  return "Cross-asset conditions are balanced. Prioritize selective signal upgrades.";
}

function ratingBandFromScore(score: number): "STRONG" | "CONSTRUCTIVE" | "NEUTRAL" | "WEAK" {
  if (score >= 7.9) return "STRONG";
  if (score >= 6.3) return "CONSTRUCTIVE";
  if (score >= 4.1) return "NEUTRAL";
  return "WEAK";
}

async function fetchSectorWindowPerformance(
  window: SectorRotationWindow
): Promise<Map<string, number | null>> {
  return fetchSectorPerformance(
    SECTOR_CONFIG.map((sector) => sector.etf),
    window
  );
}

function latestAndPreviousBySymbol(rows: PersistedAnalysis[]): Map<string, { latest: PersistedAnalysis; previous: PersistedAnalysis | null }> {
  const bySymbol = new Map<string, { latest: PersistedAnalysis; previous: PersistedAnalysis | null }>();
  for (const row of rows) {
    const existing = bySymbol.get(row.symbol);
    if (!existing) {
      bySymbol.set(row.symbol, { latest: row, previous: null });
      continue;
    }
    if (!existing.previous) {
      existing.previous = row;
    }
  }
  return bySymbol;
}

function buildSectorRotation(
  rows: PersistedAnalysis[],
  quoteMap: Map<string, QuoteRow>,
  periodPerformanceByEtf: Map<string, number | null>
): BaseDashboardPayload["sectorRotation"] {
  const latest = latestAndPreviousBySymbol(rows);
  const bucket = new Map<string, number[]>();

  for (const item of latest.values()) {
    const sector = normalizeSectorName(item.latest.sector);
    const key = sector === "Other" ? "Other" : sector;
    const values = bucket.get(key) ?? [];
    values.push(item.latest.score);
    bucket.set(key, values);
  }

  return SECTOR_CONFIG.map((sector) => {
    const values = bucket.get(sector.sector) ?? [];
    const signalScore = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const quote = quoteMap.get(sector.etf);
    const periodPerformance = periodPerformanceByEtf.get(sector.etf) ?? null;
    return {
      etf: sector.etf,
      name: sector.name,
      performancePercent: periodPerformance ?? quote?.regularMarketChangePercent ?? null,
      signalScore: signalScore !== null ? Math.round(signalScore * 10) / 10 : null,
      signalStrength: (signalScore === null ? "UNAVAILABLE" : ratingBandFromScore(signalScore)) as SectorRotationItem["signalStrength"]
    };
  })
    .sort((left, right) => (right.performancePercent ?? -999) - (left.performancePercent ?? -999))
    .slice(0, 8);
}

async function fetchQuotes(symbols: string[]): Promise<Map<string, QuoteRow>> {
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

        if (!response.ok) return;

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
      } catch {
        // Swallow per-request errors so one chunk failure does not drop the whole dashboard.
      }
    })
  );

  return map;
}

async function fetchProviderFallbackQuote(symbol: string): Promise<QuoteRow | null> {
  const [finnhub, fmp, eodhd, alpha] = await Promise.all([
    fetchFinnhubQuoteSnapshot(symbol),
    fetchFmpQuoteSnapshot(symbol),
    fetchEodhdQuoteSnapshot(symbol),
    fetchAlphaVantageQuoteSnapshot(symbol)
  ]);

  const price = finnhub.price ?? fmp.price ?? eodhd.price ?? alpha.price ?? null;
  const asOfMs = finnhub.asOfMs ?? fmp.asOfMs ?? eodhd.asOfMs ?? alpha.asOfMs ?? null;
  const changePercent = finnhub.changePercent ?? null;

  if (price === null && changePercent === null) return null;

  return {
    symbol: symbol.toUpperCase(),
    regularMarketPrice: price,
    regularMarketChangePercent: changePercent,
    asOfMs
  };
}

/**
 * Yahoo chart endpoint fallback for symbols where quote snapshots are throttled.
 * This path is resilient for indices/ETFs/futures and lets us derive change%
 * from close-to-close when quote APIs fail or are incomplete.
 */
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

    if (!response.ok) return null;

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
  } catch {
    return null;
  }
}

function toStooqSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper === "^GSPC") return "^SPX";
  if (upper === "^NDX") return "^NDX";
  if (upper === "^RUT") return "IWM.US"; // liquid proxy for Russell 2000 when index feed is unavailable
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
          if (attempt === 2) return null;
          await new Promise((resolve) => setTimeout(resolve, 160 * (attempt + 1)));
          continue;
        }
        return await response.text();
      } catch {
        if (attempt === 2) return null;
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
      const csv = liveCsv;
      const dataLine = csv
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
    const csv = historyCsv;
    const lines = csv
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
  } catch {
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
    if (!response.ok) return null;
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
      points.push({
        value,
        asOfMs: asIsoDateFromYmd(fields[0])
      });
    }
    if (points.length === 0) return null;

    const latest = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : null;
    const changePercent =
      previous && previous.value !== 0
        ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
        : null;

    return {
      symbol: "^TNX",
      regularMarketPrice: latest.value,
      regularMarketChangePercent: changePercent,
      asOfMs: latest.asOfMs
    };
  } catch {
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
    if (!response.ok) return null;
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
      points.push({
        close,
        asOfMs: asIsoDateFromMdy(fields[0])
      });
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
  } catch {
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
      if (
        symbol.toUpperCase() === "^TNX" &&
        (afterChart?.regularMarketPrice == null || afterChart?.regularMarketChangePercent == null)
      ) {
        fredMerged = await fetchFredTenYearYieldQuote();
      }

      let vixMerged: QuoteRow | null = null;
      if (
        symbol.toUpperCase() === "^VIX" &&
        (afterChart?.regularMarketPrice == null || afterChart?.regularMarketChangePercent == null)
      ) {
        vixMerged = await fetchCboeVixQuote();
      }

      const afterSpecialized = mergeQuoteRows(
        afterChart,
        mergeQuoteRows(fredMerged, vixMerged, symbol),
        symbol
      );
      if (afterSpecialized?.regularMarketPrice != null && afterSpecialized?.regularMarketChangePercent != null) {
        storeQuote(symbol, afterSpecialized);
        return;
      }

      const stooqMerged = await fetchStooqQuote(symbol);
      const afterStooq = mergeQuoteRows(afterSpecialized, stooqMerged, symbol);
      if (afterStooq?.regularMarketPrice != null && afterStooq?.regularMarketChangePercent != null) {
        storeQuote(symbol, afterStooq);
        return;
      }

      let providerMerged: QuoteRow | null = null;
      if (
        (stooqMerged?.regularMarketPrice == null || stooqMerged?.regularMarketChangePercent == null) &&
        (fredMerged?.regularMarketPrice == null || fredMerged?.regularMarketChangePercent == null) &&
        (vixMerged?.regularMarketPrice == null || vixMerged?.regularMarketChangePercent == null)
      ) {
        providerMerged = await fetchProviderFallbackQuote(symbol);
      }

      const merged = mergeQuoteRows(
        mergeQuoteRows(
          mergeQuoteRows(
            afterStooq,
            mergeQuoteRows(fredMerged, vixMerged, symbol),
            symbol
          ),
          providerMerged,
          symbol
        ),
        null,
        symbol
      );
      if (!merged) return;

      storeQuote(symbol, merged);
    }));
  }

  return enriched;
}

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-").toUpperCase();
}

function quoteValue(
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

function buildMarketMovers(
  symbols: string[],
  quoteMap: Map<string, QuoteRow>,
  companyNames: Map<string, string>
): BaseDashboardPayload["marketMovers"] {
  const uniqueSymbols = Array.from(new Set(symbols.map((value) => value.trim().toUpperCase()).filter(Boolean)));
  const movers: MarketMoverItem[] = [];

  for (const symbol of uniqueSymbols) {
    const quote = quoteValue(quoteMap, symbol, toYahooSymbol(symbol));
    const changePercent = quote?.regularMarketChangePercent ?? null;
    if (changePercent === null) continue;

    movers.push({
      symbol,
      companyName: companyNames.get(symbol) ?? symbol,
      currentPrice: quote?.regularMarketPrice ?? null,
      changePercent
    });
  }

  return movers
    .sort((left, right) => {
      const absDelta = Math.abs(right.changePercent) - Math.abs(left.changePercent);
      if (absDelta !== 0) return absDelta;
      return right.changePercent - left.changePercent || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, 3);
}

async function buildBasePayload(
  sectorWindow: SectorRotationWindow,
  previous: BaseDashboardPayload | null
): Promise<BaseDashboardPayload> {
  const analyses = await getRecentAnalyses(900, null);
  const carriedSymbols = Array.from(new Set(analyses.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))).slice(0, 140);
  const moverSymbols = Array.from(new Set([...carriedSymbols.slice(0, 20), ...FALLBACK_MOVER_SYMBOLS]));
  const moverYahooSymbols = moverSymbols.map((symbol) => toYahooSymbol(symbol));
  const latestBySymbol = latestAndPreviousBySymbol(analyses);
  const companyNames = new Map<string, string>();
  for (const [symbol, pair] of latestBySymbol.entries()) {
    companyNames.set(symbol, pair.latest.companyName || symbol);
  }

  const coreSymbols = [
    "^GSPC",
    "^NDX",
    "^RUT",
    "DX-Y.NYB",
    "DX=F",
    "^VIX",
    "CL=F",
    "^TNX",
    ...SECTOR_CONFIG.map((sector) => sector.etf)
  ];

  const symbols = Array.from(new Set([
    ...coreSymbols,
    ...moverYahooSymbols
  ]));

  const sectorWindowPerformancePromise = fetchSectorWindowPerformance(sectorWindow);
  const rawQuoteMap = await fetchQuotes(symbols);
  const coreQuoteMap = await enrichMissingQuotes(rawQuoteMap, coreSymbols);
  const quoteMap = await enrichMissingQuotes(coreQuoteMap, moverSymbols);
  const [fredTenYear, cboeVix, sectorWindowPerformance] = await Promise.all([
    fetchFredTenYearYieldQuote(),
    fetchCboeVixQuote(),
    sectorWindowPerformancePromise
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

  const tenYear = quoteValue(quoteMap, "^TNX");
  const vix = quoteValue(quoteMap, "^VIX");
  const dxy = quoteValue(quoteMap, "DX-Y.NYB", "DX=F");
  const oil = quoteValue(quoteMap, "CL=F");

  let metrics: RegimeMetric[] = [
    {
      key: "tenYearYield",
      label: "10Y Yield",
      value: yieldFromQuote(tenYear?.regularMarketPrice ?? null),
      changePercent: tenYear?.regularMarketChangePercent ?? null
    },
    {
      key: "vix",
      label: "VIX",
      value: vix?.regularMarketPrice ?? null,
      changePercent: vix?.regularMarketChangePercent ?? null
    },
    {
      key: "dxy",
      label: "DXY",
      value: dxy?.regularMarketPrice ?? null,
      changePercent: dxy?.regularMarketChangePercent ?? null
    },
    {
      key: "oil",
      label: "Oil",
      value: oil?.regularMarketPrice ?? null,
      changePercent: oil?.regularMarketChangePercent ?? null
    }
  ];

  let snapshot: SnapshotItem[] = [
    { symbol: "^GSPC", label: "SPX", price: quoteValue(quoteMap, "^GSPC")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^GSPC")?.regularMarketChangePercent ?? null },
    { symbol: "^NDX", label: "NDX", price: quoteValue(quoteMap, "^NDX")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^NDX")?.regularMarketChangePercent ?? null },
    { symbol: "^RUT", label: "RUT", price: quoteValue(quoteMap, "^RUT")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^RUT")?.regularMarketChangePercent ?? null },
    { symbol: dxy?.symbol ?? "DX-Y.NYB", label: "DXY", price: dxy?.regularMarketPrice ?? null, changePercent: dxy?.regularMarketChangePercent ?? null },
    { symbol: "^VIX", label: "VIX", price: vix?.regularMarketPrice ?? null, changePercent: vix?.regularMarketChangePercent ?? null }
  ];

  let sectorRotation = buildSectorRotation(analyses, quoteMap, sectorWindowPerformance);
  let marketMovers = buildMarketMovers(moverSymbols, quoteMap, companyNames);
  if (marketMovers.length === 0) {
    const moverFallbackRows = await Promise.all(FALLBACK_MOVER_SYMBOLS.map((symbol) => fetchYahooChartQuote(symbol)));
    moverFallbackRows.forEach((row, index) => {
      const symbol = FALLBACK_MOVER_SYMBOLS[index];
      if (!row) return;
      const existing = quoteValue(quoteMap, symbol, toYahooSymbol(symbol));
      const merged = mergeQuoteRows(existing ?? null, row, symbol);
      if (!merged) return;
      quoteMap.set(symbol, merged);
      quoteMap.set(toYahooSymbol(symbol), merged);
    });
    marketMovers = buildMarketMovers(FALLBACK_MOVER_SYMBOLS, quoteMap, companyNames);
  }

  if (previous) {
    metrics = metrics.map((metric) => {
      const prior = previous.regime.metrics.find((item) => item.key === metric.key);
      return {
        ...metric,
        value: metric.value ?? prior?.value ?? null,
        changePercent: metric.changePercent ?? prior?.changePercent ?? null
      };
    });

    snapshot = snapshot.map((item) => {
      const prior = previous.snapshot.find((candidate) => candidate.label === item.label);
      return {
        ...item,
        price: item.price ?? prior?.price ?? null,
        changePercent: item.changePercent ?? prior?.changePercent ?? null
      };
    });

    sectorRotation = sectorRotation.map((item) => {
      const prior = previous.sectorRotation.find((candidate) => candidate.etf === item.etf);
      const performancePercent = item.performancePercent ?? prior?.performancePercent ?? null;
      const signalScore = item.signalScore ?? prior?.signalScore ?? null;
      return {
        ...item,
        performancePercent,
        signalScore,
        signalStrength: signalScore === null ? "UNAVAILABLE" : ratingBandFromScore(signalScore)
      };
    });

    if (marketMovers.length < 3 && previous.marketMovers.length > 0) {
      const seen = new Set(marketMovers.map((item) => item.symbol));
      const carryForward = previous.marketMovers.filter((item) => !seen.has(item.symbol));
      marketMovers = [...marketMovers, ...carryForward].slice(0, 3);
    }
  }

  const regimeLabel = buildRegimeLabel(metrics[1].value, metrics[2].changePercent, metrics[3].changePercent);

  return {
    generatedAt: new Date().toISOString(),
    sectorWindow,
    regime: {
      label: regimeLabel,
      summary: buildRegimeSummary(regimeLabel, metrics),
      metrics
    },
    snapshot,
    marketMovers,
    sectorRotation
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-home-dashboard",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  const url = new URL(request.url);
  const sectorWindow = parseSectorWindow(url.searchParams.get("sectorWindow"));
  const cached = baseCacheByWindow.get(sectorWindow);

  if (!cached || Date.now() > cached.expiresAt) {
    let inFlight = basePayloadInFlightByWindow.get(sectorWindow);
    if (!inFlight) {
      inFlight = buildBasePayload(sectorWindow, cached?.payload ?? null);
      basePayloadInFlightByWindow.set(sectorWindow, inFlight);
    }

    try {
      const payload = await inFlight;
      baseCacheByWindow.set(sectorWindow, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload
      });
    } finally {
      basePayloadInFlightByWindow.delete(sectorWindow);
    }
  }

  const payload = baseCacheByWindow.get(sectorWindow)?.payload;
  if (!payload) {
    return NextResponse.json(
      { error: "Failed to build dashboard payload." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    payload,
    {
      headers: {
        "Cache-Control": "private, no-store"
      }
    }
  );
}
