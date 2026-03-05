import { NextResponse } from "next/server";

import { getFetchSignal } from "@/lib/market/adapter-utils";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { publishIndicesYtd } from "@/lib/realtime/publisher";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IndexCode = "US30" | "US100" | "US500";

interface IndexConfig {
  code: IndexCode;
  label: string;
  symbol: string;
  yahooSymbol: string;
}

interface IndexYtdRow {
  code: IndexCode;
  label: string;
  symbol: string;
  current: number | null;
  ytdChangePercent: number | null;
  asOf: string | null;
  points: number[];
}

interface CacheState {
  expiresAt: number;
  payload: { indices: IndexYtdRow[] };
}

const INDEX_CONFIGS: IndexConfig[] = [
  { code: "US30", label: "US30", symbol: "^dji", yahooSymbol: "^DJI" },
  { code: "US100", label: "US100", symbol: "^ndx", yahooSymbol: "^NDX" },
  { code: "US500", label: "US500", symbol: "^spx", yahooSymbol: "^GSPC" }
];

const CACHE_HEADER_OPEN = "public, max-age=120, s-maxage=300, stale-while-revalidate=600";
const CACHE_HEADER_CLOSED = "public, max-age=300, s-maxage=900, stale-while-revalidate=1800";
const MAX_POINTS = 42;
const CURRENT_YEAR = new Date().getUTCFullYear();
const YAHOO_RANGE = "1y";
const YAHOO_INTERVAL = "1d";
const INDEX_FETCH_TIMEOUT_MS = 3_500;

let indicesCache: CacheState | null = null;
const lastGoodByCode: Partial<Record<IndexCode, IndexYtdRow>> = {};

function parseCsvNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function downsample(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) {
    return values;
  }

  const step = (values.length - 1) / (maxPoints - 1);
  const sampled: number[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round(index * step);
    sampled.push(values[sourceIndex] ?? values[values.length - 1] ?? 0);
  }

  return sampled;
}

async function fetchStooqYtdRow(config: IndexConfig): Promise<IndexYtdRow> {
  const historyUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(config.symbol)}&i=d`;
  const quoteUrl = `https://stooq.com/q/l/?s=${encodeURIComponent(config.symbol)}&f=sd2t2ohlcv&h&e=csv`;

  try {
    const [historyResponse, quoteResponse] = await Promise.all([
      fetch(historyUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: getFetchSignal(INDEX_FETCH_TIMEOUT_MS)
      }),
      fetch(quoteUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: getFetchSignal(INDEX_FETCH_TIMEOUT_MS)
      })
    ]);

    if (!historyResponse.ok) {
      throw new Error(`Stooq history failed with status ${historyResponse.status}`);
    }

    const csv = await historyResponse.text();
    const lines = csv
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
      return {
        code: config.code,
        label: config.label,
        symbol: config.symbol.toUpperCase(),
        current: null,
        ytdChangePercent: null,
        asOf: null,
        points: []
      };
    }

    const rows = lines
      .slice(1)
      .map((line) => {
        const columns = line.split(",");
        const isoDate = columns[0] ?? "";
        const close = parseCsvNumber(columns[4]);
        const asOfMs = Date.parse(`${isoDate}T00:00:00Z`);

        if (!Number.isFinite(asOfMs) || close === null) {
          return null;
        }

        return { isoDate, asOfMs, close };
      })
      .filter((row): row is { isoDate: string; asOfMs: number; close: number } => row !== null);

    if (rows.length === 0) {
      return {
        code: config.code,
        label: config.label,
        symbol: config.symbol.toUpperCase(),
        current: null,
        ytdChangePercent: null,
        asOf: null,
        points: []
      };
    }

    const latestHistory = rows[rows.length - 1];
    let latestClose = latestHistory?.close ?? null;
    let asOfDate = latestHistory?.isoDate ?? null;

    if (quoteResponse.ok) {
      const quoteCsv = await quoteResponse.text();
      const quoteLines = quoteCsv
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      if (quoteLines.length >= 2) {
        const columns = quoteLines[1]?.split(",") ?? [];
        const quoteDate = columns[1] ?? null;
        const quoteClose = parseCsvNumber(columns[6]);
        if (quoteClose !== null) {
          latestClose = quoteClose;
        }
        if (quoteDate) {
          asOfDate = quoteDate;
        }
      }
    }

    const currentYear = new Date().getUTCFullYear();
    const ytdRows = rows.filter((row) => row.isoDate.startsWith(`${currentYear}-`));
    const effectiveRows = ytdRows.length >= 2 ? ytdRows : rows.slice(Math.max(0, rows.length - 260));
    const startClose = effectiveRows[0]?.close ?? null;

    const ytdChangePercent =
      startClose !== null && latestClose !== null && startClose !== 0
        ? ((latestClose - startClose) / startClose) * 100
        : null;

    return {
      code: config.code,
      label: config.label,
      symbol: config.symbol.toUpperCase(),
      current: latestClose,
      ytdChangePercent,
      asOf: asOfDate,
      points: downsample(effectiveRows.map((row) => row.close), MAX_POINTS)
    };
  } catch {
    return {
      code: config.code,
      label: config.label,
      symbol: config.symbol.toUpperCase(),
      current: null,
      ytdChangePercent: null,
      asOf: null,
      points: []
    };
  }
}

async function fetchYahooYtdRow(config: IndexConfig): Promise<IndexYtdRow> {
  const baseUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.yahooSymbol)}`;
  const url = `${baseUrl}?interval=${YAHOO_INTERVAL}&range=${YAHOO_RANGE}`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: getFetchSignal(INDEX_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!response.ok) {
      throw new Error(`Yahoo chart failed with status ${response.status}`);
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
          meta?: {
            regularMarketPrice?: number;
            symbol?: string;
          };
        }>;
      };
    };

    const result = payload.chart?.result?.[0];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];

    const rows = timestamps
      .map((ts, idx) => {
        const close = closes[idx];
        if (typeof close !== "number" || !Number.isFinite(close)) return null;
        const date = new Date(ts * 1000);
        if (Number.isNaN(date.getTime())) return null;
        return {
          isoDate: date.toISOString().slice(0, 10),
          close
        };
      })
      .filter((row): row is { isoDate: string; close: number } => row !== null);

    if (rows.length === 0) {
      throw new Error("Yahoo chart returned no usable rows.");
    }

    const latest = rows[rows.length - 1];
    const ytdRows = rows.filter((row) => row.isoDate.startsWith(`${CURRENT_YEAR}-`));
    const effectiveRows = ytdRows.length >= 2 ? ytdRows : rows;
    const startClose = effectiveRows[0]?.close ?? null;
    const latestClose = latest?.close ?? result?.meta?.regularMarketPrice ?? null;
    const ytdChangePercent =
      typeof latestClose === "number" && startClose !== null && startClose !== 0
        ? ((latestClose - startClose) / startClose) * 100
        : null;

    return {
      code: config.code,
      label: config.label,
      symbol: result?.meta?.symbol ?? config.yahooSymbol,
      current: typeof latestClose === "number" ? latestClose : null,
      ytdChangePercent,
      asOf: latest?.isoDate ?? null,
      points: downsample(effectiveRows.map((row) => row.close), MAX_POINTS)
    };
  } catch {
    return {
      code: config.code,
      label: config.label,
      symbol: config.yahooSymbol,
      current: null,
      ytdChangePercent: null,
      asOf: null,
      points: []
    };
  }
}

async function fetchRobustIndexRow(config: IndexConfig): Promise<IndexYtdRow> {
  // Run both providers in parallel to cut tail latency while keeping source preference.
  const [stooq, yahoo] = await Promise.all([fetchStooqYtdRow(config), fetchYahooYtdRow(config)]);
  if (stooq.current !== null && stooq.points.length > 0) {
    return stooq;
  }

  if (yahoo.current !== null && yahoo.points.length > 0) {
    return yahoo;
  }

  return stooq.current !== null || stooq.points.length > 0 ? stooq : yahoo;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const throttled = enforceRateLimit(request, {
      bucket: "api-indices-ytd",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const liveOpen = isNySessionOpen();
    const cacheHeader = liveOpen ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED;

    if (indicesCache && Date.now() < indicesCache.expiresAt) {
      return NextResponse.json(indicesCache.payload, { headers: { "Cache-Control": cacheHeader } });
    }

    const fetchedRows = await Promise.all(INDEX_CONFIGS.map((config) => fetchRobustIndexRow(config)));
    const indices = fetchedRows.map((row) => {
      if (row.current !== null && row.points.length > 0) {
        lastGoodByCode[row.code] = row;
        return row;
      }
      return lastGoodByCode[row.code] ?? row;
    });
    const payload = { indices };
    indicesCache = {
      expiresAt: Date.now() + (liveOpen ? 5 * 60 * 1000 : 15 * 60 * 1000),
      payload
    };
    await publishIndicesYtd(payload);

    return NextResponse.json(payload, { headers: { "Cache-Control": cacheHeader } });
  } catch (error) {
    console.error("/api/indices/ytd GET error", error);
    if (indicesCache) {
      return NextResponse.json(indicesCache.payload, {
        headers: { "Cache-Control": CACHE_HEADER_CLOSED }
      });
    }

    return NextResponse.json(
      {
        indices: INDEX_CONFIGS.map((config) => ({
          code: config.code,
          label: config.label,
          symbol: config.symbol.toUpperCase(),
          current: null,
          ytdChangePercent: null,
          asOf: null,
          points: []
        }))
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
