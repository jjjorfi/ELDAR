import { NextResponse } from "next/server";

import { isNySessionOpen } from "@/lib/market/ny-session";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IndexCode = "US30" | "US100" | "US500";

interface IndexConfig {
  code: IndexCode;
  label: string;
  symbol: string;
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
  { code: "US30", label: "US30", symbol: "^dji" },
  { code: "US100", label: "US100", symbol: "^ndx" },
  { code: "US500", label: "US500", symbol: "^spx" }
];

const CACHE_HEADER_OPEN = "public, max-age=120, s-maxage=300, stale-while-revalidate=600";
const CACHE_HEADER_CLOSED = "public, max-age=300, s-maxage=900, stale-while-revalidate=1800";
const MAX_POINTS = 42;

let indicesCache: CacheState | null = null;

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
        cache: "no-store"
      }),
      fetch(quoteUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store"
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

    const indices = await Promise.all(INDEX_CONFIGS.map((config) => fetchStooqYtdRow(config)));
    const payload = { indices };
    indicesCache = {
      expiresAt: Date.now() + (liveOpen ? 5 * 60 * 1000 : 15 * 60 * 1000),
      payload
    };

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
