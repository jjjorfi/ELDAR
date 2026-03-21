// This file adds Alpaca market data as a temporary quote/history bridge while
// premium provider entitlements are still being expanded. It only feeds
// continuity paths and should be reviewed once the long-term paid stack is
// fully active.

import { parseOptionalNumber, parseTimestampMs, readEnvToken } from "@/lib/market/adapter-utils";
import {
  buildDashedAndDottedSymbolCandidates,
  createProviderSuppression,
  fetchJsonRecordWithSuppression
} from "@/lib/market/providers/provider-helpers";

export interface AlpacaQuoteSnapshot {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

export interface AlpacaHistoryPoint {
  date: Date;
  close: number;
}

const ALPACA_DEFAULT_BASE_URL = "https://data.alpaca.markets/v2";
const ALPACA_FETCH_TIMEOUT_MS = 4_500;
const ALPACA_AUTH_DISABLE_TTL_MS = 10 * 60_000;
const ALPACA_RATE_LIMIT_DISABLE_TTL_MS = 60_000;
const ALPACA_MAX_HISTORY_PAGES = 10;
const ALPACA_FEED = "iex";
const alpacaSuppression = createProviderSuppression({ adapterLabel: "Alpaca" });

/**
 * Reads the configured Alpaca key ID.
 *
 * @returns Alpaca key ID when configured, otherwise null.
 */
function alpacaKeyId(): string | null {
  return readEnvToken("ALPACA_API_KEY") ?? readEnvToken("ALPACA_API_KEY_ID") ?? readEnvToken("APCA_API_KEY_ID");
}

/**
 * Reads the configured Alpaca secret key.
 *
 * @returns Alpaca secret when configured, otherwise null.
 */
function alpacaSecretKey(): string | null {
  return readEnvToken("ALPACA_API_SECRET") ?? readEnvToken("ALPACA_SECRET_KEY") ?? readEnvToken("APCA_API_SECRET_KEY");
}

/**
 * Resolves the Alpaca data base URL.
 *
 * @returns Base URL for Alpaca market-data requests.
 */
function alpacaBaseUrl(): string {
  return readEnvToken("ALPACA_DATA_BASE_URL") ?? ALPACA_DEFAULT_BASE_URL;
}

/**
 * Indicates whether Alpaca credentials are available.
 *
 * @returns True when both key ID and secret are configured.
 */
export function isAlpacaConfigured(): boolean {
  return alpacaKeyId() !== null && alpacaSecretKey() !== null;
}

/**
 * Parses numeric Alpaca fields.
 *
 * @param value Raw provider field.
 * @returns Finite parsed number or null.
 */
function parseNumber(value: unknown): number | null {
  return parseOptionalNumber(value, { allowCommas: true, allowPercent: true });
}

/**
 * Builds preferred Alpaca symbol variants.
 *
 * @param symbol Input ticker.
 * @returns Deduplicated provider-friendly symbol candidates.
 */
function symbolCandidates(symbol: string): string[] {
  return buildDashedAndDottedSymbolCandidates(symbol);
}

/**
 * Builds Alpaca auth headers from configured credentials.
 *
 * @returns Auth headers or null when credentials are incomplete.
 */
function getAuthHeaders(): Record<string, string> | null {
  const keyId = alpacaKeyId();
  const secret = alpacaSecretKey();
  if (!keyId || !secret) return null;
  return {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret
  };
}

/**
 * Classifies text-only Alpaca payload failures into suppression windows.
 *
 * @param payload Parsed Alpaca payload.
 * @returns Suppression descriptor or null.
 */
function classifyPayloadFailure(payload: Record<string, unknown>): { ttlMs: number; label: "auth" | "rate-limit" } | null {
  const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";

  if (message.includes("forbidden") || message.includes("unauthorized")) {
    return { ttlMs: ALPACA_AUTH_DISABLE_TTL_MS, label: "auth" };
  }

  if (message.includes("limit") || message.includes("quota") || message.includes("too many")) {
    return { ttlMs: ALPACA_RATE_LIMIT_DISABLE_TTL_MS, label: "rate-limit" };
  }

  return null;
}

/**
 * Executes an Alpaca request with timeout, auth, and suppression handling.
 *
 * @param path Endpoint path relative to the Alpaca base URL.
 * @param params Query parameters.
 * @returns Parsed payload or null when unavailable.
 */
async function fetchAlpaca(path: string, params: Record<string, string | number | null> = {}): Promise<Record<string, unknown> | null> {
  const authHeaders = getAuthHeaders();
  if (!authHeaders) return null;

  return fetchJsonRecordWithSuppression({
    adapterLabel: "Alpaca",
    service: "provider-alpaca",
    baseUrl: alpacaBaseUrl(),
    path,
    params,
    headers: authHeaders,
    timeoutMs: ALPACA_FETCH_TIMEOUT_MS,
    suppression: alpacaSuppression,
    authTtlMs: ALPACA_AUTH_DISABLE_TTL_MS,
    rateLimitTtlMs: ALPACA_RATE_LIMIT_DISABLE_TTL_MS,
    rateLimitStatuses: [429],
    classifyPayloadFailure
  });
}

/**
 * Selects the most relevant snapshot row from mixed Alpaca response shapes.
 *
 * @param payload Parsed Alpaca payload.
 * @param symbol Input ticker.
 * @returns Snapshot row or null.
 */
function parseSnapshotRow(payload: Record<string, unknown>, symbol: string): Record<string, unknown> | null {
  for (const candidate of symbolCandidates(symbol)) {
    const direct = payload[candidate];
    if (typeof direct === "object" && direct !== null) {
      return direct as Record<string, unknown>;
    }
  }

  const snapshots = typeof payload.snapshots === "object" && payload.snapshots !== null
    ? (payload.snapshots as Record<string, unknown>)
    : null;
  if (snapshots) {
    for (const candidate of symbolCandidates(symbol)) {
      const row = snapshots[candidate];
      if (typeof row === "object" && row !== null) {
        return row as Record<string, unknown>;
      }
    }
  }

  for (const value of Object.values(payload)) {
    if (typeof value !== "object" || value === null) continue;
    const row = value as Record<string, unknown>;
    if (typeof row.dailyBar === "object" || typeof row.latestTrade === "object" || typeof row.minuteBar === "object") {
      return row;
    }
  }

  if (snapshots) {
    for (const value of Object.values(snapshots)) {
      if (typeof value === "object" && value !== null) {
        return value as Record<string, unknown>;
      }
    }
  }

  for (const value of Object.values(payload)) {
    if (typeof value === "object" && value !== null) {
      return value as Record<string, unknown>;
    }
  }

  return null;
}

/**
 * Reads a numeric value from a top-level row field.
 *
 * @param row Provider row object.
 * @param key Field name.
 * @returns Parsed number or null.
 */
function fromRowNumber(row: Record<string, unknown>, key: string): number | null {
  if (typeof row[key] === "number") return parseNumber(row[key]);
  if (typeof row[key] === "string") return parseNumber(row[key]);
  return null;
}

/**
 * Reads a numeric value from a nested row field.
 *
 * @param row Provider row object.
 * @param parent Nested object key.
 * @param child Nested field key.
 * @returns Parsed number or null.
 */
function fromNestedRowNumber(row: Record<string, unknown>, parent: string, child: string): number | null {
  const nested = typeof row[parent] === "object" && row[parent] !== null ? (row[parent] as Record<string, unknown>) : null;
  if (!nested) return null;
  return fromRowNumber(nested, child);
}

/**
 * Reads a nested timestamp field and converts it to epoch milliseconds.
 *
 * @param row Provider row object.
 * @param parent Nested object key.
 * @param child Nested field key.
 * @returns Parsed timestamp or null.
 */
function fromNestedTimestampMs(row: Record<string, unknown>, parent: string, child: string): number | null {
  const nested = typeof row[parent] === "object" && row[parent] !== null ? (row[parent] as Record<string, unknown>) : null;
  if (!nested) return null;
  return parseTimestampMs(nested[child]);
}

/**
 * Fetches the latest Alpaca quote snapshot.
 *
 * @param symbol Input ticker.
 * @returns Best-effort quote snapshot.
 */
export async function fetchAlpacaQuoteSnapshot(symbol: string): Promise<AlpacaQuoteSnapshot> {
  if (!isAlpacaConfigured()) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const payload = await fetchAlpaca("stocks/snapshots", {
    symbols: symbolCandidates(symbol)[0] ?? symbol.trim().toUpperCase(),
    feed: ALPACA_FEED
  });
  if (!payload) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const row = parseSnapshotRow(payload, symbol);
  if (!row) {
    return { price: null, changePercent: null, asOfMs: null };
  }

  const minuteClose = fromNestedRowNumber(row, "minuteBar", "c");
  const latestTrade = fromNestedRowNumber(row, "latestTrade", "p");
  const dailyClose = fromNestedRowNumber(row, "dailyBar", "c");
  const ask = fromNestedRowNumber(row, "latestQuote", "ap");
  const bid = fromNestedRowNumber(row, "latestQuote", "bp");
  const mid = ask !== null && bid !== null ? (ask + bid) / 2 : null;

  const price = minuteClose ?? latestTrade ?? dailyClose ?? mid ?? null;
  const prevDailyClose = fromNestedRowNumber(row, "prevDailyBar", "c");
  const changePercent =
    price !== null && prevDailyClose !== null && prevDailyClose !== 0
      ? ((price - prevDailyClose) / Math.abs(prevDailyClose)) * 100
      : null;

  const asOfMs =
    fromNestedTimestampMs(row, "minuteBar", "t") ??
    fromNestedTimestampMs(row, "latestTrade", "t") ??
    fromNestedTimestampMs(row, "dailyBar", "t") ??
    null;

  return {
    price,
    changePercent,
    asOfMs
  };
}

/**
 * Fetches Alpaca daily bar history and normalizes it into chronological close
 * points.
 *
 * @param symbol Input ticker.
 * @param lookbackDays Requested lookback horizon.
 * @returns Sorted daily history points.
 */
export async function fetchAlpacaDailyHistory(symbol: string, lookbackDays: number): Promise<AlpacaHistoryPoint[]> {
  if (!isAlpacaConfigured()) {
    return [];
  }

  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - Math.max(30, lookbackDays) * 24 * 60 * 60 * 1000).toISOString();

  for (const candidate of symbolCandidates(symbol)) {
    const points: AlpacaHistoryPoint[] = [];
    let pageToken: string | null = null;

    for (let page = 0; page < ALPACA_MAX_HISTORY_PAGES; page += 1) {
      const payload = await fetchAlpaca(`stocks/${encodeURIComponent(candidate)}/bars`, {
        timeframe: "1Day",
        start: startIso,
        end: endIso,
        adjustment: "raw",
        feed: ALPACA_FEED,
        sort: "asc",
        limit: 1000,
        page_token: pageToken
      });

      if (!payload) break;

      const bars = Array.isArray(payload.bars) ? payload.bars : [];
      for (const entry of bars) {
        if (typeof entry !== "object" || entry === null) continue;
        const row = entry as Record<string, unknown>;
        const close = parseNumber(row.c) ?? parseNumber(row.close);
        const timestampMs = parseTimestampMs(row.t ?? row.timestamp);
        if (close === null || close <= 0 || timestampMs === null) continue;
        points.push({
          date: new Date(timestampMs),
          close
        });
      }

      pageToken = typeof payload.next_page_token === "string" && payload.next_page_token.trim().length > 0
        ? payload.next_page_token
        : null;
      if (!pageToken) break;
    }

    if (points.length > 0) {
      const deduped = new Map<string, AlpacaHistoryPoint>();
      for (const point of points) {
        const key = point.date.toISOString().slice(0, 10);
        const existing = deduped.get(key);
        if (!existing || point.date > existing.date) {
          deduped.set(key, point);
        }
      }
      return Array.from(deduped.values()).sort((a, b) => +a.date - +b.date);
    }
  }

  return [];
}
