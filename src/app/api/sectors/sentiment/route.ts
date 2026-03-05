import { NextResponse } from "next/server";

import { getFetchSignal } from "@/lib/market/adapter-utils";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTOR_ETFS = ["XLK", "XLF", "XLV", "XLY", "XLC", "XLI", "XLP", "XLE", "XLU", "XLRE", "XLB"] as const;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_HEADER = "public, max-age=300, s-maxage=600, stale-while-revalidate=1200";
const SECTOR_FETCH_TIMEOUT_MS = 3_500;

type SectorSentiment = "bullish" | "neutral" | "bearish";

interface SectorSentimentRow {
  etf: string;
  changePercent: number | null;
  sentiment: SectorSentiment;
  asOfMs: number | null;
}

let sectorsCache:
  | {
      expiresAt: number;
      payload: { sectors: SectorSentimentRow[] };
    }
  | null = null;

function safeNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifySentiment(changePercent: number | null): SectorSentiment {
  if (typeof changePercent !== "number") return "neutral";
  if (changePercent >= 0.35) return "bullish";
  if (changePercent <= -0.35) return "bearish";
  return "neutral";
}

async function fetchStooqSectorSentiment(etf: string): Promise<SectorSentimentRow> {
  const url = `https://stooq.com/q/d/l/?s=${etf.toLowerCase()}.us&i=d`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: getFetchSignal(SECTOR_FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Stooq request failed (${response.status})`);
    }

    const csv = await response.text();
    const lines = csv
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
      return { etf, changePercent: null, sentiment: "neutral", asOfMs: null };
    }

    const records = lines
      .slice(1)
      .map((line) => {
        const columns = line.split(",");
        const isoDate = columns[0] ?? "";
        const close = safeNumber(columns[4] ?? "");
        const asOfMs = Date.parse(`${isoDate}T00:00:00Z`);
        return {
          close,
          asOfMs: Number.isFinite(asOfMs) ? asOfMs : null
        };
      })
      .filter((record) => record.close !== null && record.asOfMs !== null) as Array<{
      close: number;
      asOfMs: number;
    }>;

    if (records.length === 0) {
      return { etf, changePercent: null, sentiment: "neutral", asOfMs: null };
    }

    const latest = records[records.length - 1];
    const yearStartMs = Date.UTC(new Date().getUTCFullYear(), 0, 1);
    const ytdStart = records.find((record) => record.asOfMs >= yearStartMs) ?? records[0];

    const changePercent =
      latest.close !== 0 && ytdStart.close !== 0
        ? ((latest.close - ytdStart.close) / ytdStart.close) * 100
        : null;

    const asOfMs = latest.asOfMs;

    return {
      etf,
      changePercent,
      sentiment: classifySentiment(changePercent),
      asOfMs: Number.isFinite(asOfMs ?? NaN) ? asOfMs : null
    };
  } catch {
    return { etf, changePercent: null, sentiment: "neutral", asOfMs: null };
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
      bucket: "api-sectors-sentiment",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    if (sectorsCache && Date.now() < sectorsCache.expiresAt) {
      return NextResponse.json(sectorsCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }

    const sectors = await Promise.all(SECTOR_ETFS.map((etf) => fetchStooqSectorSentiment(etf)));
    const payload = { sectors };

    sectorsCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": CACHE_HEADER } });
  } catch (error) {
    console.error("/api/sectors/sentiment GET error", error);
    if (sectorsCache) {
      return NextResponse.json(sectorsCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }
    return NextResponse.json({
      sectors: SECTOR_ETFS.map((etf) => ({ etf, changePercent: null, sentiment: "neutral", asOfMs: null }))
    }, { headers: { "Cache-Control": CACHE_HEADER } });
  }
}
