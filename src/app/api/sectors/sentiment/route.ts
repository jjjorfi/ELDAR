import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import {
  DEFAULT_SECTOR_WINDOW,
  classifySectorSentiment,
  fetchSectorPerformance
} from "@/lib/market/sector-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTOR_ETFS = ["XLK", "XLF", "XLV", "XLY", "XLC", "XLI", "XLP", "XLE", "XLU", "XLRE", "XLB"] as const;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_HEADER = "public, max-age=300, s-maxage=600, stale-while-revalidate=1200";

interface SectorSentimentRow {
  etf: string;
  changePercent: number | null;
  sentiment: "bullish" | "neutral" | "bearish";
  asOfMs: number | null;
}

let sectorsCache:
  | {
      expiresAt: number;
      payload: { sectors: SectorSentimentRow[] };
    }
  | null = null;
let sectorsInFlight: Promise<{ sectors: SectorSentimentRow[] }> | null = null;

async function fetchSectorSentimentPayload(): Promise<{ sectors: SectorSentimentRow[] }> {
  const performanceMap = await fetchSectorPerformance(SECTOR_ETFS, DEFAULT_SECTOR_WINDOW);
  return {
    sectors: SECTOR_ETFS.map((etf) => {
      const changePercent = performanceMap.get(etf) ?? null;
      return {
        etf,
        changePercent,
        sentiment: classifySectorSentiment(changePercent),
        asOfMs: Date.now()
      };
    })
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-sectors-sentiment",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    if (sectorsCache && Date.now() < sectorsCache.expiresAt) {
      return NextResponse.json(sectorsCache.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }

    if (!sectorsInFlight) {
      sectorsInFlight = fetchSectorSentimentPayload();
    }

    const payload = await sectorsInFlight;

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
  } finally {
    sectorsInFlight = null;
  }
}
