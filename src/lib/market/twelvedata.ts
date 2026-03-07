// AI CONTEXT TRACE
// This file adds Twelve Data as a temporary quote/history fallback while ELDAR
// is still on free-tier market data. It only feeds quote/history rescue paths
// through temporary-fallbacks.ts and should be demoted or removed once premium
// provider quotas/entitlements are live. Gotcha: do not treat this as a full
// fundamentals source; it is intentionally limited to price-oriented patches.

import { getFetchSignal, parseOptionalNumber, parseTimestampMs, readEnvToken, setUrlSearchParams } from "@/lib/market/adapter-utils";

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
const TWELVE_DATA_FETCH_TIMEOUT_MS = 4_500;
const TWELVE_DATA_AUTH_DISABLE_TTL_MS = 10 * 60_000;
const TWELVE_DATA_RATE_LIMIT_DISABLE_TTL_MS = 60_000;

let twelveDataDisabledUntil = 0;
let twelveDataWarnedAt = 0;

function twelveDataApiKey(): string | null {
  return readEnvToken("TWELVEDATA_API_KEY") ?? readEnvToken("TWELVE_DATA_API_KEY");
}

export function isTwelveDataConfigured(): boolean {
  return twelveDataApiKey() !== null;
}

function parseNumber(value: unknown): number | null {
  return parseOptionalNumber(value, { allowCommas: true, allowPercent: true });
}

function symbolCandidates(symbol: string): string[] {
  const upper = symbol.trim().toUpperCase();
  return Array.from(new Set([upper, upper.replace(/\./g, "-")])).filter(Boolean);
}

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

function suppressTemporarily(reason: { ttlMs: number; label: string } | null): void {
  if (!reason) return;
  twelveDataDisabledUntil = Date.now() + reason.ttlMs;
  if (Date.now() - twelveDataWarnedAt > reason.ttlMs) {
    twelveDataWarnedAt = Date.now();
    console.warn(
      `[Twelve Data Adapter]: temporary ${reason.label} suppression for ${Math.round(reason.ttlMs / 1000)}s.`
    );
  }
}

async function fetchTwelveData(path: string, params: Record<string, string | number>): Promise<Record<string, unknown> | null> {
  const apiKey = twelveDataApiKey();
  if (!apiKey) {
    return null;
  }

  if (Date.now() < twelveDataDisabledUntil) {
    return null;
  }

  const url = new URL(`${TWELVE_DATA_BASE_URL}/${path}`);
  setUrlSearchParams(url, {
    ...params,
    apikey: apiKey
  });

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: getFetchSignal(TWELVE_DATA_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      const ttlMs =
        response.status === 429 ? TWELVE_DATA_RATE_LIMIT_DISABLE_TTL_MS : response.status === 401 || response.status === 403
          ? TWELVE_DATA_AUTH_DISABLE_TTL_MS
          : 0;
      suppressTemporarily(ttlMs > 0 ? { ttlMs, label: response.status === 429 ? "rate-limit" : "auth" } : null);
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    suppressTemporarily(classifyPayloadFailure(payload));

    if (classifyPayloadFailure(payload)) {
      return null;
    }

    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Twelve Data error.";
    console.warn(`[Twelve Data Adapter]: ${message}`);
    return null;
  }
}

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
