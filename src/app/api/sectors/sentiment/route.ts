import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { GICS_SECTOR_ETFS } from "@/lib/market/universe/gics-sectors";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_HEADER = "public, max-age=300, s-maxage=600, stale-while-revalidate=1200";
const REDIS_TTL_SECONDS = 10 * 60;

interface SectorSentimentRow {
  etf: string;
  changePercent: number | null;
  sentiment: "bullish" | "neutral" | "bearish";
  asOfMs: number | null;
}

interface SectorSentimentPayload {
  sectors: SectorSentimentRow[];
  stale?: boolean;
}

let sectorsCache:
  | {
      expiresAt: number;
      payload: SectorSentimentPayload;
    }
  | null = null;

function sectorsRedisKey(): string {
  return "sectors:sentiment:YTD";
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
      return NextResponse.json(sectorsCache.payload, {
        headers: {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": sectorsCache.payload.stale ? "stale" : "fresh"
        }
      });
    }

    const redisCached = await cacheGetJson<SectorSentimentPayload>(sectorsRedisKey());
    if (redisCached) {
      sectorsCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload: redisCached
      };
      return NextResponse.json(redisCached, {
        headers: {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": redisCached.stale ? "stale" : "fresh"
        }
      });
    }

    const snapshotRead = await getAggregateSnapshotForRead<SectorSentimentPayload>({
      key: AGGREGATE_SNAPSHOT_KEYS.SECTOR_SENTIMENT_YTD,
      priority: "scheduled",
      reason: "api-sectors-sentiment",
      requestedBy: null
    });

    const payload = snapshotRead.snapshot?.payload ?? null;
    if (!payload) {
      return NextResponse.json(
        {
          sectors: GICS_SECTOR_ETFS.map((etf) => ({ etf, changePercent: null, sentiment: "neutral", asOfMs: null })),
          stale: true,
          pending: true,
          refreshQueued: snapshotRead.enqueued
        },
        {
          status: 202,
          headers: {
            "Cache-Control": CACHE_HEADER,
            "X-ELDAR-Data-State": "warming"
          }
        }
      );
    }

    sectorsCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload
    };
    await cacheSetJson(sectorsRedisKey(), payload, REDIS_TTL_SECONDS);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": CACHE_HEADER,
        "X-ELDAR-Data-State": snapshotRead.state
      }
    });
  } catch (error) {
    console.error("/api/sectors/sentiment GET error", error);
    if (sectorsCache) {
      return NextResponse.json(
        {
          ...sectorsCache.payload,
          stale: true
        },
        {
          headers: {
            "Cache-Control": CACHE_HEADER,
            "X-ELDAR-Data-State": "stale"
          }
        }
      );
    }
    return NextResponse.json(
      {
        sectors: GICS_SECTOR_ETFS.map((etf) => ({ etf, changePercent: null, sentiment: "neutral", asOfMs: null })),
        stale: true
      },
      {
        status: 503,
        headers: {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": "degraded"
        }
      }
    );
  }
}
