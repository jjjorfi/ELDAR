// This file adds Twelve Data as a temporary quote/history fallback while ELDAR
// is still on free-tier market data. It only feeds quote/history rescue paths
// through temporary-fallbacks.ts and should be demoted or removed once premium
// provider quotas/entitlements are live. Gotcha: do not treat this as a full
// fundamentals source; it is intentionally limited to price-oriented patches.

import { parseOptionalNumber, parseTimestampMs, readEnvToken } from "@/lib/market/adapter-utils";
import {
  buildDashedSymbolCandidates,
  createProviderSuppression,
  fetchJsonRecordWithSuppression
} from "@/lib/market/providers/provider-helpers";

export interface TwelveDataQuoteSnapshot {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

export interface TwelveDataHistoryPoint {
  date: Date;
  close: number;
}

const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com";
const TWELVE_DATA_FETCH_TIMEOUT_MS = 2_000;
const TWELVE_DATA_AUTH_DISABLE_TTL_MS = 10 * 60_000;
const TWELVE_DATA_RATE_LIMIT_DISABLE_TTL_MS = 60_000;
const twelveDataSuppression = createProviderSuppression({ adapterLabel: "Twelve Data" });

/**
 * Reads the configured Twelve Data API key.
 *
 * @returns API key value when configured, otherwise null.
 */
function twelveDataApiKey(): string | null {
  return readEnvToken("TWELVEDATA_API_KEY") ?? readEnvToken("TWELVE_DATA_API_KEY");
}

/**
 * Indicates whether Twelve Data is configured.
 *
 * @returns True when a valid API key is present.
 */
export function isTwelveDataConfigured(): boolean {
  return twelveDataApiKey() !== null;
}

/**
 * Parses a numeric Twelve Data field.
 *
 * @param value Raw provider value.
 * @returns Finite parsed number or null.
 */
function parseNumber(value: unknown): number | null {
  return parseOptionalNumber(value, { allowCommas: true, allowPercent: true });
}

/**
 * Builds preferred Twelve Data ticker variants.
 *
 * @param symbol Input ticker.
 * @returns Candidate symbols in provider-friendly order.
 */
function symbolCandidates(symbol: string): string[] {
  return buildDashedSymbolCandidates(symbol);
}

/**
 * Classifies provider payload errors into suppression windows.
 *
 * @param payload Parsed Twelve Data payload.
 * @returns Temporary suppression descriptor or null.
 */
function classifyPayloadFailure(payload: Record<string, unknown>): { ttlMs: number; label: string } | null {
  const rawMessage = typeof payload.message === "string" ? payload.message : typeof payload.status === "string" ? payload.status : "";
  const message = rawMessage.toLowerCase();
  const code = parseNumber(payload.code);

  if (code === 401 || code === 403 || /invalid api key|forbidden|unauthorized/.test(message)) {
    return { ttlMs: TWELVE_DATA_AUTH_DISABLE_TTL_MS, label: "auth" };
  }

  if (code === 429 || /limit|quota|credit|too many requests/.test(message)) {
    return { ttlMs: TWELVE_DATA_RATE_LIMIT_DISABLE_TTL_MS, label: "rate-limit" };
  }

  return null;
}

/**
 * Executes a Twelve Data request with common auth, timeout, and suppression
 * handling.
 *
 * @param path Endpoint path under the Twelve Data base URL.
 * @param params Query parameters.
 * @returns Parsed payload or null when the request cannot be used.
 */
async function fetchTwelveData(path: string, params: Record<string, string | number>): Promise<Record<string, unknown> | null> {
  const apiKey = twelveDataApiKey();
  if (!apiKey) {
    return null;
  }

  return fetchJsonRecordWithSuppression({
    adapterLabel: "Twelve Data",
    service: "provider-twelvedata",
    baseUrl: TWELVE_DATA_BASE_URL,
    path,
    params: {
      ...params,
      apikey: apiKey
    },
    timeoutMs: TWELVE_DATA_FETCH_TIMEOUT_MS,
    suppression: twelveDataSuppression,
    authTtlMs: TWELVE_DATA_AUTH_DISABLE_TTL_MS,
    rateLimitTtlMs: TWELVE_DATA_RATE_LIMIT_DISABLE_TTL_MS,
    classifyPayloadFailure
  });
}

/**
 * Fetches the latest quote snapshot available from Twelve Data.
 *
 * @param symbol Input ticker.
 * @returns Best-effort quote snapshot.
 */
export async function fetchTwelveDataQuoteSnapshot(symbol: string): Promise<TwelveDataQuoteSnapshot> {
  if (!isTwelveDataConfigured()) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  for (const candidate of symbolCandidates(symbol)) {
    const payload = await fetchTwelveData("quote", { symbol: candidate });
    if (!payload) continue;

    const price = parseNumber(payload.close) ?? parseNumber(payload.price) ?? parseNumber(payload.last);
    const previousClose = parseNumber(payload.previous_close);
    const changePercent =
      parseNumber(payload.percent_change) ??
      (price !== null && previousClose !== null && previousClose !== 0
        ? ((price - previousClose) / Math.abs(previousClose)) * 100
        : null);

    const asOfMs =
      parseTimestampMs(payload.timestamp) ??
      parseTimestampMs(payload.datetime) ??
      parseTimestampMs(payload.last_quote_at);

    if (price !== null && price > 0) {
      return {
        price,
        changePercent,
        asOfMs
      };
    }
  }

  return { price: null, changePercent: null, asOfMs: null };
}

/**
 * Fetches daily history from Twelve Data and normalizes it into chronological
 * close points.
 *
 * @param symbol Input ticker.
 * @param outputSize Maximum number of daily rows to request.
 * @returns Sorted daily history points.
 */
export async function fetchTwelveDataDailyHistory(
  symbol: string,
  outputSize: number
): Promise<TwelveDataHistoryPoint[]> {
  if (!isTwelveDataConfigured()) {
    return [];
  }

  for (const candidate of symbolCandidates(symbol)) {
    const payload = await fetchTwelveData("time_series", {
      symbol: candidate,
      interval: "1day",
      outputsize: Math.max(10, Math.min(5000, Math.round(outputSize))),
      order: "ASC",
      format: "JSON"
    });

    if (!payload) continue;

    const values = Array.isArray(payload.values) ? payload.values : [];
    const points = values
      .map((value) => {
        if (typeof value !== "object" || value === null) return null;
        const row = value as Record<string, unknown>;
        const close = parseNumber(row.close) ?? parseNumber(row.adj_close);
        const rawDate = typeof row.datetime === "string" ? row.datetime : null;
        if (!rawDate || close === null || close <= 0) return null;
        const date = new Date(rawDate);
        if (Number.isNaN(date.getTime())) return null;
        return {
          date,
          close
        };
      })
      .filter((point): point is TwelveDataHistoryPoint => point !== null)
      .sort((a, b) => +a.date - +b.date);

    if (points.length > 0) {
      return points;
    }
  }

  return [];
}
