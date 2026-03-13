import { errorResponse, okResponse } from "@/lib/api";
import { log } from "@/lib/logger";
import { runRouteGuards } from "@/lib/api/route-security";
import { emptyIndicesYtdPayload, isUsableIndicesYtdPayload, type IndicesYtdPayload } from "@/lib/home/indices-ytd";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";
import { getAggregateSnapshot } from "@/lib/snapshots/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER_OPEN = "public, max-age=120, s-maxage=300, stale-while-revalidate=600";
const CACHE_HEADER_CLOSED = "public, max-age=300, s-maxage=900, stale-while-revalidate=1800";
const AGGREGATE_KEY = AGGREGATE_SNAPSHOT_KEYS.INDICES_YTD;

function cacheHeader(): string {
  return isNySessionOpen() ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED;
}

export async function GET(request: Request) {
  const blocked = await runRouteGuards(request, {
    bucket: "api-indices-ytd",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const snapshotRead = await getAggregateSnapshotForRead<IndicesYtdPayload>({
      key: AGGREGATE_KEY,
      priority: "hot",
      reason: "api-indices-ytd",
      requestedBy: null
    });

    let payload = isUsableIndicesYtdPayload(snapshotRead.snapshot?.payload ?? null) ? snapshotRead.snapshot!.payload : null;
    let dataState = snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "");

    if (!payload) {
      const persisted = await getAggregateSnapshot<IndicesYtdPayload>(AGGREGATE_KEY);
      if (isUsableIndicesYtdPayload(persisted?.payload ?? null)) {
        payload = persisted!.payload;
        dataState = "stale-persisted";
      }
    }

    if (!payload) {
      return okResponse(
        {
          ...emptyIndicesYtdPayload(),
          pending: true,
          refreshQueued: true
        },
        {
          status: 202,
          headers: {
            "Cache-Control": "no-store",
            "X-ELDAR-Data-State": "warming"
          }
        }
      );
    }

    log({
      level: "info",
      service: "api-indices-ytd",
      message: "Indices payload resolved",
      dataState
    });

    return okResponse(payload, {
      headers: {
        "Cache-Control": cacheHeader(),
        "X-ELDAR-Data-State": dataState
      }
    });
  } catch (error) {
    const persisted = await getAggregateSnapshot<IndicesYtdPayload>(AGGREGATE_KEY).catch(() => null);
    if (isUsableIndicesYtdPayload(persisted?.payload ?? null)) {
      return okResponse(persisted!.payload, {
        headers: {
          "Cache-Control": CACHE_HEADER_CLOSED,
          "X-ELDAR-Data-State": "degraded-stale"
        }
      });
    }

    return errorResponse(
      error,
      { route: "api-indices-ytd" },
      {
        "Cache-Control": "no-store",
        "X-ELDAR-Data-State": "degraded"
      }
    );
  }
}
