import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";
import { getAggregateSnapshot } from "@/lib/snapshots/store";

import { priceHistoryAggregateKey } from "@/lib/features/price/history-service";
import type { PriceHistoryPayload, PriceRange } from "@/lib/features/price/types";

export interface PriceHistoryReadResult {
  payload: PriceHistoryPayload | null;
  snapshotState: "fresh" | "stale" | "missing";
  cacheLayer: string;
  enqueued: boolean;
}

function isUsablePriceHistoryPayload(payload: PriceHistoryPayload | null | undefined): payload is PriceHistoryPayload {
  return Boolean(payload && Array.isArray(payload.points) && payload.points.length > 1);
}

/**
 * Resolves price-history data from persisted aggregate snapshots only.
 *
 * Missing or stale aggregates are queued for asynchronous rebuild. This keeps
 * provider fetches off the user-facing request path.
 *
 * @param symbol - Supported uppercase symbol.
 * @param range - Requested price-history range.
 * @returns Snapshot-backed read result.
 */
export async function resolvePriceHistoryPayload(symbol: string, range: PriceRange): Promise<PriceHistoryReadResult> {
  const key = priceHistoryAggregateKey(symbol, range);
  const snapshotRead = await getAggregateSnapshotForRead<PriceHistoryPayload>({
    key,
    priority: "hot",
    reason: "api-price-history",
    requestedBy: null
  });

  const activeSnapshot = snapshotRead.snapshot;
  if (activeSnapshot) {
    const payload = isUsablePriceHistoryPayload(activeSnapshot.payload) ? activeSnapshot.payload : null;
    if (payload) {
      return {
        payload,
        snapshotState: snapshotRead.state,
        cacheLayer: snapshotRead.state === "fresh" ? "snapshot" : "snapshot-stale",
        enqueued: snapshotRead.enqueued
      };
    }
  }

  const persisted = await getAggregateSnapshot<PriceHistoryPayload>(key);
  if (persisted) {
    const payload = isUsablePriceHistoryPayload(persisted.payload) ? persisted.payload : null;
    if (payload) {
      return {
        payload,
        snapshotState: "stale",
        cacheLayer: "snapshot-stale-persisted",
        enqueued: true
      };
    }
  }

  return {
    payload: null,
    snapshotState: snapshotRead.state,
    cacheLayer: "warming",
    enqueued: true
  };
}
