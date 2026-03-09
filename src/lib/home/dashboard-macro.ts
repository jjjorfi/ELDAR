// AI CONTEXT TRACE
// Dedicated macro builder for the home dashboard. This keeps the V2 macro
// regime engine and its data plumbing out of the main dashboard service so the
// home payload stays thin and cached.

import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { getFetchSignal } from "@/lib/market/adapter-utils";
import type { HomeDashboardPayload, HomeRegimeMetric } from "@/lib/home/dashboard-types";
import {
  scoreMacroV2,
  type GateFired,
  type IndicatorResult,
  type MacroInputV2,
  type MacroRegimeV2,
  type MacroScoreV2
} from "@/lib/scoring/eldar-macro-v2";

const MACRO_CACHE_TTL_MS = 5 * 60_000;
const MACRO_REDIS_TTL_SECONDS = 300;
const MACRO_LAST_GOOD_REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;
const YAHOO_CHART_TIMEOUT_MS = 3_500;
const FRED_TIMEOUT_MS = 8_000;
const LOG_TTL_MS = 60_000;

type HomeRegimePayload = HomeDashboardPayload["regime"];

interface TimeSeriesPoint {
  date: string;
  value: number;
  timeMs: number;
}

let macroCache: { expiresAt: number; payload: HomeRegimePayload } | null = null;
let macroInFlight: Promise<HomeRegimePayload> | null = null;
const recentWarnings = new Map<string, number>();

function macroRedisKey(): string {
  return "home:dashboard:macro:v3";
}

function macroLastGoodRedisKey(): string {
  return "home:dashboard:macro:last-good:v1";
}

function warnOnce(scope: string, message: string): void {
  const key = `${scope}:${message}`;
  const now = Date.now();
  const previous = recentWarnings.get(key) ?? 0;
  if (now - previous < LOG_TTL_MS) {
    return;
  }
  recentWarnings.set(key, now);
  console.warn(`[Dashboard Macro][${scope}]: ${message}`);
}

function parseCsvDate(raw: string): number | null {
  const parsed = Date.parse(`${raw.trim()}T21:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvSeries(csv: string, valueIndex = 1): TimeSeriesPoint[] {
  return csv
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("observation_date"))
    .map((line) => {
      const fields = line.split(",");
      const timeMs = parseCsvDate(fields[0] ?? "");
      const rawValue = (fields[valueIndex] ?? "").trim();
      const value =
        rawValue.length === 0 || rawValue === "."
          ? Number.NaN
          : Number(rawValue);
      return {
        date: fields[0] ?? "",
        value,
        timeMs
      };
    })
    .filter(
      (row): row is TimeSeriesPoint =>
        !!row.date && row.timeMs !== null && Number.isFinite(row.value)
    );
}

async function fetchFredSeries(seriesId: string): Promise<TimeSeriesPoint[]> {
  try {
    const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`, {
      cache: "no-store",
      signal: getFetchSignal(FRED_TIMEOUT_MS),
      headers: {
        Accept: "text/csv",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) {
      warnOnce("fred", `${seriesId} failed (${response.status})`);
      return [];
    }
    return parseCsvSeries(await response.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown FRED error";
    warnOnce("fred", `${seriesId} ${message}`);
    return [];
  }
}

async function fetchYahooDailySeries(symbol: string, range = "6mo"): Promise<TimeSeriesPoint[]> {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("range", range);
    url.searchParams.set("interval", "1d");

    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: getFetchSignal(YAHOO_CHART_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      warnOnce("yahoo", `${symbol} failed (${response.status})`);
      return [];
    }

    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
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
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];

    const series: TimeSeriesPoint[] = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      const ts = timestamps[index];
      const close = closes[index];
      if (!Number.isFinite(ts) || typeof close !== "number" || !Number.isFinite(close)) {
        continue;
      }
      series.push({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        value: close,
        timeMs: ts * 1000
      });
    }

    return series;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Yahoo chart error";
    warnOnce("yahoo", `${symbol} ${message}`);
    return [];
  }
}

async function fetchYahooDailySeriesWithFallback(
  primarySymbol: string,
  fallbackSymbol: string,
  range = "6mo"
): Promise<TimeSeriesPoint[]> {
  const primary = await fetchYahooDailySeries(primarySymbol, range);
  if (primary.length > 0) {
    return primary;
  }
  return fetchYahooDailySeries(fallbackSymbol, range);
}

function latestValue(points: TimeSeriesPoint[]): number | null {
  return points.length > 0 ? points[points.length - 1].value : null;
}

function latestDate(points: TimeSeriesPoint[]): string | null {
  return points.length > 0 ? points[points.length - 1].date : null;
}

function latestPoint(points: TimeSeriesPoint[]): TimeSeriesPoint | null {
  return points.length > 0 ? points[points.length - 1] : null;
}

function pointAtOrBefore(points: TimeSeriesPoint[], cutoffMs: number): TimeSeriesPoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].timeMs <= cutoffMs) {
      return points[index];
    }
  }
  return points[0] ?? null;
}

function absDeltaSinceDays(points: TimeSeriesPoint[], days: number): number | null {
  const latest = latestPoint(points);
  if (!latest) return null;
  const base = pointAtOrBefore(points, latest.timeMs - days * 24 * 60 * 60 * 1000);
  if (!base) return null;
  return latest.value - base.value;
}

function pctDeltaSinceDays(points: TimeSeriesPoint[], days: number): number | null {
  const latest = latestPoint(points);
  if (!latest) return null;
  const base = pointAtOrBefore(points, latest.timeMs - days * 24 * 60 * 60 * 1000);
  if (!base || base.value === 0) return null;
  return ((latest.value - base.value) / Math.abs(base.value)) * 100;
}

function deltaBpsSinceDays(points: TimeSeriesPoint[], days: number, multiplier = 1): number | null {
  const latest = latestPoint(points);
  if (!latest) return null;
  const base = pointAtOrBefore(points, latest.timeMs - days * 24 * 60 * 60 * 1000);
  if (!base) return null;
  return (latest.value - base.value) * multiplier;
}

function computeCurrentThreeMonthAverage(points: TimeSeriesPoint[]): number | null {
  const tail = points.slice(-3);
  if (tail.length < 3) return null;
  return tail.reduce((sum, row) => sum + row.value, 0) / tail.length;
}

function computeTrailingTwelveMonthThreeMonthMin(points: TimeSeriesPoint[]): number | null {
  if (points.length < 14) return null;
  const rollingAverages: number[] = [];
  for (let index = 2; index < points.length; index += 1) {
    const slice = points.slice(index - 2, index + 1);
    rollingAverages.push(slice.reduce((sum, row) => sum + row.value, 0) / slice.length);
  }
  const trailingWindow = rollingAverages.slice(-12);
  if (trailingWindow.length === 0) return null;
  return Math.min(...trailingWindow);
}

function computeCpiYoY(points: TimeSeriesPoint[]): number | null {
  if (points.length < 13) return null;
  const latest = points[points.length - 1];
  const baseline = points[points.length - 13];
  if (!baseline || baseline.value === 0) return null;
  return ((latest.value - baseline.value) / baseline.value) * 100;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function indicatorTone(score: number): HomeRegimeMetric["tone"] {
  if (score >= 0.2) return "positive";
  if (score <= -0.2) return "negative";
  return "neutral";
}

function formatSignedNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
}

function formatMetricDetail(change: number | null, suffix: string, digits = 1): string {
  if (change === null || !Number.isFinite(change)) return "Change unavailable";
  return `${formatSignedNumber(change, digits)}${suffix}`;
}

function buildSummary(score: MacroScoreV2): string {
  const firstGate = score.gatesFired[0];
  if (score.regime === "MAXIMUM_EXPANSION") {
    return "Plumbing is clear and macro pressure is low. Full-size risk can stay on until credit or bond vol deteriorates.";
  }
  if (score.regime === "CONSTRUCTIVE_BIAS") {
    return "Macro conditions are supportive, but the tape still needs plumbing confirmation. Monitor MOVE and HYG OAS first.";
  }
  if (score.regime === "CHOP_DISTRIBUTION") {
    return "Signals are conflicting. Expect fakeouts, reduce size, and wait for plumbing or cycle to resolve the tie.";
  }
  if (score.regime === "DEFENSIVE_LIQUIDATION") {
    return firstGate
      ? `Macro has turned defensive. ${firstGate.effect}`
      : "Macro stress is building. Hedge long exposure and prioritize defense.";
  }
  return firstGate
    ? `Systemic stress is active. ${firstGate.effect}`
    : "Systemic risk is dominating. Preserve liquidity and do not fight the regime.";
}

function formatRegimeMetric(
  key: HomeRegimeMetric["key"],
  label: string,
  value: number | null,
  displayValue: string,
  detail: string,
  indicator: IndicatorResult
): HomeRegimeMetric {
  return {
    key,
    label,
    value,
    displayValue,
    detail,
    tone: indicatorTone(indicator.finalScore)
  };
}

function mergeInput(
  current: Partial<MacroInputV2>,
  previous: MacroInputV2 | null
): MacroInputV2 | null {
  const merged = { ...(previous ?? {}) } as Partial<MacroInputV2>;

  for (const [rawKey, rawValue] of Object.entries(current) as Array<[keyof MacroInputV2, MacroInputV2[keyof MacroInputV2] | undefined]>) {
    if (rawKey === "date") {
      if (typeof rawValue === "string" && rawValue.length > 0) {
        merged[rawKey] = rawValue;
      }
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      merged[rawKey] = rawValue;
    }
  }

  const requiredKeys: Array<keyof MacroInputV2> = [
    "date",
    "move",
    "moveDelta1M",
    "hygOAS",
    "hygOASDelta1M",
    "realYield10Y",
    "realYieldChange3M",
    "yieldCurve",
    "oilWTI",
    "oilChange1M",
    "unemploymentRate",
    "unemployment3MAvg",
    "unemployment3MMin12",
    "vix",
    "dxy",
    "dxyChange1M",
    "cpiYoY",
    "cuAuRatio",
    "cuAuMa20"
  ];

  for (const key of requiredKeys) {
    const value = merged[key];
    if (key === "date") {
      if (typeof value !== "string" || value.length === 0) {
        return null;
      }
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
  }

  return merged as MacroInputV2;
}

function findMissingInputKeys(candidate: Partial<MacroInputV2>): string[] {
  const requiredKeys: Array<keyof MacroInputV2> = [
    "date",
    "move",
    "moveDelta1M",
    "hygOAS",
    "hygOASDelta1M",
    "realYield10Y",
    "realYieldChange3M",
    "yieldCurve",
    "oilWTI",
    "oilChange1M",
    "unemploymentRate",
    "unemployment3MAvg",
    "unemployment3MMin12",
    "vix",
    "dxy",
    "dxyChange1M",
    "cpiYoY",
    "cuAuRatio",
    "cuAuMa20"
  ];

  return requiredKeys.filter((key) => {
    const value = candidate[key];
    if (key === "date") {
      return typeof value !== "string" || value.length === 0;
    }
    return typeof value !== "number" || !Number.isFinite(value);
  });
}

async function buildMacroPayload(previous: HomeRegimePayload | null): Promise<HomeRegimePayload> {
  const [
    moveSeries,
    vixSeries,
    dxySeries,
    oilSeries,
    copperSeries,
    goldSeries,
    hygSeries,
    realYieldSeries,
    yieldCurveSeries,
    nominalTenYearSeries,
    twoYearSeries,
    unrateSeries,
    cpiSeries
  ] = await Promise.all([
    fetchYahooDailySeries("^MOVE"),
    fetchYahooDailySeries("^VIX"),
    fetchYahooDailySeriesWithFallback("DX-Y.NYB", "DX=F"),
    fetchYahooDailySeries("CL=F"),
    fetchYahooDailySeries("HG=F"),
    fetchYahooDailySeries("GC=F"),
    fetchFredSeries("BAMLH0A0HYM2"),
    fetchFredSeries("DFII10"),
    fetchFredSeries("T10Y2Y"),
    fetchFredSeries("DGS10"),
    fetchFredSeries("DGS2"),
    fetchFredSeries("UNRATE"),
    fetchFredSeries("CPIAUCSL")
  ]);

  const fallbackYieldCurveValue =
    latestValue(nominalTenYearSeries) !== null && latestValue(twoYearSeries) !== null
      ? (latestValue(nominalTenYearSeries)! - latestValue(twoYearSeries)!) * 100
      : null;

  const copperGoldRatios = copperSeries
    .map((row, index) => {
      const gold = goldSeries[index];
      if (!gold || gold.date !== row.date || gold.value === 0) {
        return null;
      }
      return {
        date: row.date,
        timeMs: row.timeMs,
        value: row.value / gold.value
      } satisfies TimeSeriesPoint;
    })
    .filter((row): row is TimeSeriesPoint => row !== null);

  const cuAuRatio = latestValue(copperGoldRatios);
  const cuAuMa20 =
    copperGoldRatios.length >= 20
      ? copperGoldRatios.slice(-20).reduce((sum, row) => sum + row.value, 0) / 20
      : null;

  const currentThreeMonthAverage = computeCurrentThreeMonthAverage(unrateSeries);
  const trailingMin = computeTrailingTwelveMonthThreeMonthMin(unrateSeries);

  const partialInput: Partial<MacroInputV2> = {
    date:
      latestDate(realYieldSeries) ??
      latestDate(moveSeries) ??
      latestDate(unrateSeries) ??
      new Date().toISOString().slice(0, 10),
    move: round(latestValue(moveSeries), 3) ?? undefined,
    moveDelta1M: round(absDeltaSinceDays(moveSeries, 30), 1) ?? undefined,
    hygOAS: round(latestValue(hygSeries) !== null ? latestValue(hygSeries)! * 100 : null, 0) ?? undefined,
    hygOASDelta1M: round(deltaBpsSinceDays(hygSeries, 30, 100), 0) ?? undefined,
    realYield10Y: round(latestValue(realYieldSeries), 2) ?? undefined,
    realYieldChange3M: round(deltaBpsSinceDays(realYieldSeries, 90, 100), 0) ?? undefined,
    yieldCurve:
      round(
        latestValue(yieldCurveSeries) !== null
          ? latestValue(yieldCurveSeries)! * 100
          : fallbackYieldCurveValue,
        0
      ) ?? undefined,
    oilWTI: round(latestValue(oilSeries), 2) ?? undefined,
    oilChange1M: round(pctDeltaSinceDays(oilSeries, 30), 1) ?? undefined,
    unemploymentRate: round(latestValue(unrateSeries), 2) ?? undefined,
    unemployment3MAvg: round(currentThreeMonthAverage, 3) ?? undefined,
    unemployment3MMin12: round(trailingMin, 3) ?? undefined,
    vix: round(latestValue(vixSeries), 2) ?? undefined,
    dxy: round(latestValue(dxySeries), 2) ?? undefined,
    dxyChange1M: round(pctDeltaSinceDays(dxySeries, 30), 1) ?? undefined,
    cpiYoY: round(computeCpiYoY(cpiSeries), 2) ?? undefined,
    cuAuRatio: round(cuAuRatio, 6) ?? undefined,
    cuAuMa20: round(cuAuMa20, 6) ?? undefined
  };

  const mergedInput = mergeInput(partialInput, previous?.inputSnapshot ?? null);
  if (!mergedInput) {
    const missingKeys = findMissingInputKeys({
      ...(previous?.inputSnapshot ?? {}),
      ...partialInput
    });
    warnOnce("builder", `incomplete fresh macro inputs (${missingKeys.join(", ") || "unknown"})`);
    if (previous) {
      return previous;
    }
    throw new Error(`Macro regime inputs are incomplete: ${missingKeys.join(", ")}`);
  }

  const score = scoreMacroV2(mergedInput);
  const metrics: HomeRegimeMetric[] = [
    formatRegimeMetric(
      "vix",
      "VIX",
      mergedInput.vix,
      mergedInput.vix.toFixed(1),
      latestValue(vixSeries) !== null ? "Volatility gauge" : "Feed unavailable",
      score.pillars.sentiment.indicators[0]
    ),
    formatRegimeMetric(
      "dxy",
      "DXY",
      mergedInput.dxy,
      mergedInput.dxy.toFixed(1),
      formatMetricDetail(mergedInput.dxyChange1M, "% vs 1M", 1),
      score.pillars.sentiment.indicators[1]
    ),
    formatRegimeMetric(
      "oilWTI",
      "WTI Oil",
      mergedInput.oilWTI,
      `$${mergedInput.oilWTI.toFixed(0)}`,
      formatMetricDetail(mergedInput.oilChange1M, "% vs 1M", 1),
      score.pillars.cycle.indicators[2]
    ),
    formatRegimeMetric(
      "nominal10Y",
      "10Y Yield",
      latestValue(nominalTenYearSeries),
      latestValue(nominalTenYearSeries) !== null ? `${latestValue(nominalTenYearSeries)!.toFixed(2)}%` : "N/A",
      formatMetricDetail(deltaBpsSinceDays(nominalTenYearSeries, 30, 100), "bps vs 1M", 0),
      score.pillars.cycle.indicators[0]
    )
  ];

  return {
    label: score.regime,
    summary: buildSummary(score),
    compositeScore: score.compositeScore,
    formulaScore: score.formulaScore,
    modelVersion: score.modelVersion,
    confidence: score.confidence,
    warnings: score.warnings,
    gatesFired: score.gatesFired,
    pillars: score.pillars,
    inputSnapshot: mergedInput,
    metrics
  };
}

export async function getDashboardMacroRegime(previous: HomeRegimePayload | null): Promise<HomeRegimePayload> {
  if (macroCache && Date.now() < macroCache.expiresAt) {
    return macroCache.payload;
  }

  const redisCached = await cacheGetJson<HomeRegimePayload>(macroRedisKey());
  if (redisCached) {
    macroCache = {
      expiresAt: Date.now() + MACRO_CACHE_TTL_MS,
      payload: redisCached
    };
    return redisCached;
  }

  const lastKnownGood = await cacheGetJson<HomeRegimePayload>(macroLastGoodRedisKey());
  const seedPayload = previous ?? macroCache?.payload ?? lastKnownGood ?? null;

  if (!macroInFlight) {
    macroInFlight = buildMacroPayload(seedPayload)
      .then(async (payload) => {
        macroCache = {
          expiresAt: Date.now() + MACRO_CACHE_TTL_MS,
          payload
        };
        await Promise.all([
          cacheSetJson(macroRedisKey(), payload, MACRO_REDIS_TTL_SECONDS),
          cacheSetJson(macroLastGoodRedisKey(), payload, MACRO_LAST_GOOD_REDIS_TTL_SECONDS)
        ]);
        return payload;
      })
      .catch((error) => {
        if (seedPayload) {
          warnOnce("builder", "fresh macro inputs failed; using last known good regime");
          macroCache = {
            expiresAt: Date.now() + MACRO_CACHE_TTL_MS,
            payload: seedPayload
          };
          return seedPayload;
        }
        throw error;
      })
      .finally(() => {
        macroInFlight = null;
      });
  }

  return macroInFlight;
}
