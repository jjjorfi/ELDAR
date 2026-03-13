import type { Mag7SnapshotPayload } from "@/lib/mag7";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";
import { getAggregateSnapshot } from "@/lib/snapshots/store";

export interface Mag7ReadResult {
  payload: Mag7SnapshotPayload | null;
  snapshotState: "fresh" | "stale" | "missing";
  cacheLayer: string;
  enqueued: boolean;
}

function isUsableMag7Payload(payload: Mag7SnapshotPayload | null | undefined): payload is Mag7SnapshotPayload {
  return Boolean(payload && Array.isArray(payload.cards) && payload.cards.length > 0);
}

function mag7AggregateKey(mode: "live" | "home"): string {
  return mode === "live" ? AGGREGATE_SNAPSHOT_KEYS.MAG7_LIVE : AGGREGATE_SNAPSHOT_KEYS.MAG7_HOME;
}

/**
 * Resolves MAG7 cards from aggregate snapshots only.
 *
 * Missing or stale snapshots are queued for asynchronous rebuild so public MAG7
 * routes stay provider-free on the request path.
 *
 * @param mode - Live or homepage payload mode.
 * @returns Snapshot-backed MAG7 payload result.
 */
export async function resolveMag7Payload(mode: "live" | "home"): Promise<Mag7ReadResult> {
  const key = mag7AggregateKey(mode);
  const snapshotRead = await getAggregateSnapshotForRead<Mag7SnapshotPayload>({
    key,
    priority: "hot",
    reason: `api-mag7:${mode}`,
    requestedBy: null
  });

  const activeSnapshot = snapshotRead.snapshot;
  if (activeSnapshot) {
    const payload = isUsableMag7Payload(activeSnapshot.payload) ? activeSnapshot.payload : null;
    if (payload) {
      return {
        payload,
        snapshotState: snapshotRead.state,
        cacheLayer: snapshotRead.state === "fresh" ? "snapshot" : "snapshot-stale",
        enqueued: snapshotRead.enqueued
      };
    }
  }

  const persisted = await getAggregateSnapshot<Mag7SnapshotPayload>(key);
  if (persisted) {
    const payload = isUsableMag7Payload(persisted.payload) ? persisted.payload : null;
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
