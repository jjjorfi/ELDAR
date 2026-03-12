// This file adds marketstack as a temporary end-of-day fallback while ELDAR is
// still operating on constrained free-tier data. It is intentionally limited to
// quote/history rescue paths and should be removed or downgraded once premium
// market-data quotas are available. Gotcha: free marketstack is EOD-oriented,
// so it must never outrank true live providers when they are healthy.

import { getFetchSignal, parseOptionalNumber, parseTimestampMs, readEnvToken, setUrlSearchParams } from "@/lib/market/adapter-utils";

export interface MarketstackQuoteSnapshot {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

export interface MarketstackHistoryPoint {
  date: Date;
  close: number;
}

const MARKETSTACK_BASE_URL = "https://api.marketstack.com/v2";
const MARKETSTACK_FETCH_TIMEOUT_MS = 4_500;
const MARKETSTACK_AUTH_DISABLE_TTL_MS = 10 * 60_000;
const MARKETSTACK_RATE_LIMIT_DISABLE_TTL_MS = 60_000;

let marketstackDisabledUntil = 0;
let marketstackWarnedAt = 0;

function marketstackApiKey(): string | null {
  return readEnvToken("MARKETSTACK_API_KEY") ?? readEnvToken("MARKET_STACK_API_KEY");
}

export function isMarketstackConfigured(): boolean {
  return marketstackApiKey() !== null;
}

function parseNumber(value: unknown): number | null {
  return parseOptionalNumber(value, { allowCommas: true, allowPercent: true });
}

function symbolCandidates(symbol: string): string[] {
  const upper = symbol.trim().toUpperCase();
  return Array.from(new Set([upper, upper.replace(/\./g, "-")])).filter(Boolean);
}

function suppressTemporarily(ttlMs: number, label: string): void {
  marketstackDisabledUntil = Date.now() + ttlMs;
  if (Date.now() - marketstackWarnedAt > ttlMs) {
    marketstackWarnedAt = Date.now();
    console.warn(`[Marketstack Adapter]: temporary ${label} suppression for ${Math.round(ttlMs / 1000)}s.`);
  }
}

function classifyPayloadFailure(payload: Record<string, unknown>): { ttlMs: number; label: string } | null {
  const errorRecord =
    typeof payload.error === "object" && payload.error !== null ? (payload.error as Record<string, unknown>) : null;
  const code = parseNumber(errorRecord?.code);
  const message = typeof errorRecord?.message === "string" ? errorRecord.message.toLowerCase() : "";

  if (code === 401 || code === 403 || /invalid|unauthorized|forbidden/.test(message)) {
    return { ttlMs: MARKETSTACK_AUTH_DISABLE_TTL_MS, label: "auth" };
  }
  if (code === 402 || code === 429 || /limit|quota|credit|too many requests/.test(message)) {
    return { ttlMs: MARKETSTACK_RATE_LIMIT_DISABLE_TTL_MS, label: "rate-limit" };
  }
  return null;
}

async function fetchMarketstack(path: string, params: Record<string, string | number>): Promise<Record<string, unknown> | null> {
  const apiKey = marketstackApiKey();
  if (!apiKey) {
    return null;
  }

  if (Date.now() < marketstackDisabledUntil) {
    return null;
  }

  const url = new URL(`${MARKETSTACK_BASE_URL}/${path}`);
  setUrlSearchParams(url, {
    ...params,
    access_key: apiKey
  });

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: getFetchSignal(MARKETSTACK_FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        suppressTemporarily(MARKETSTACK_AUTH_DISABLE_TTL_MS, "auth");
      } else if (response.status === 402 || response.status === 429) {
        suppressTemporarily(MARKETSTACK_RATE_LIMIT_DISABLE_TTL_MS, "rate-limit");
      }
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const failure = classifyPayloadFailure(payload);
    if (failure) {
      suppressTemporarily(failure.ttlMs, failure.label);
      return null;
    }

    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown marketstack error.";
    console.warn(`[Marketstack Adapter]: ${message}`);
    return null;
  }
}

function parseLatestEodRow(payload: Record<string, unknown>, requestedSymbol: string): Record<string, unknown> | null {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const candidates = symbolCandidates(requestedSymbol);

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const symbol = typeof record.symbol === "string" ? record.symbol.toUpperCase() : "";
    if (candidates.includes(symbol)) {
      return record;
    }
  }

  for (const row of rows) {
    if (typeof row === "object" && row !== null) {
      return row as Record<string, unknown>;
    }
  }

  return null;
}

export async function fetchMarketstackQuoteSnapshot(symbol: string): Promise<MarketstackQuoteSnapshot> {
  if (!isMarketstackConfigured()) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const payload = await fetchMarketstack("eod/latest", {
    symbols: symbolCandidates(symbol).join(",")
  });

  if (!payload) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const row = parseLatestEodRow(payload, symbol);
  if (!row) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const price = parseNumber(row.adj_close) ?? parseNumber(row.close);
  const open = parseNumber(row.adj_open) ?? parseNumber(row.open);
  const changePercent =
    price !== null && open !== null && open !== 0 ? ((price - open) / Math.abs(open)) * 100 : null;

  return {
    price,
    changePercent,
    asOfMs: parseTimestampMs(row.date)
  };
}

export async function fetchMarketstackDailyHistory(
  symbol: string,
  lookbackDays: number
): Promise<MarketstackHistoryPoint[]> {
  if (!isMarketstackConfigured()) {
    return [];
  }

  const dateFrom = new Date(Date.now() - Math.max(30, lookbackDays) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const payload = await fetchMarketstack("eod", {
    symbols: symbolCandidates(symbol).join(","),
    date_from: dateFrom,
    limit: Math.min(1000, Math.max(50, lookbackDays + 50)),
    sort: "ASC"
  });

  if (!payload) {
    return [];
  }

  const rows = Array.isArray(payload.data) ? payload.data : [];
  const candidates = symbolCandidates(symbol);

  return rows
    .map((value) => {
      if (typeof value !== "object" || value === null) return null;
      const row = value as Record<string, unknown>;
      const rowSymbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
      if (rowSymbol && !candidates.includes(rowSymbol)) return null;
      const close = parseNumber(row.adj_close) ?? parseNumber(row.close);
      const rawDate = typeof row.date === "string" ? row.date : null;
      if (!rawDate || close === null || close <= 0) return null;
      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) return null;
      return {
        date,
        close
      };
    })
    .filter((point): point is MarketstackHistoryPoint => point !== null)
    .sort((a, b) => +a.date - +b.date);
}
