import type { HomeDashboardPayload, SectorRotationWindow } from "@/lib/home/dashboard-types";
import { isUsableHomeDashboardPayload } from "@/lib/home/dashboard-validators";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";
import { getAggregateSnapshot } from "@/lib/snapshots/store";

export interface HomeDashboardReadResult {
  payload: HomeDashboardPayload | null;
  snapshotState: "fresh" | "stale" | "missing";
  cacheLayer: string;
  enqueued: boolean;
}

export function aggregateDashboardKey(window: SectorRotationWindow): string {
  if (window === "1M") return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_1M;
  if (window === "3M") return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_3M;
  if (window === "6M") return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_6M;
  return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_YTD;
}

function selectUsableDashboardPayload(payload: HomeDashboardPayload | null | undefined): HomeDashboardPayload | null {
  return isUsableHomeDashboardPayload(payload) ? payload : null;
}

export async function resolveHomeDashboardPayload(window: SectorRotationWindow): Promise<HomeDashboardReadResult> {
  const key = aggregateDashboardKey(window);
  const snapshotRead = await getAggregateSnapshotForRead<HomeDashboardPayload>({
    key,
    priority: "hot",
    reason: "api-home-dashboard",
    requestedBy: null
  });

  const activeSnapshot = snapshotRead.snapshot;
  if (activeSnapshot) {
    const payload = selectUsableDashboardPayload(activeSnapshot.payload);
    if (payload) {
      return {
        payload,
        snapshotState: snapshotRead.state,
        cacheLayer: snapshotRead.state === "fresh" ? "snapshot" : "snapshot-stale",
        enqueued: snapshotRead.enqueued
      };
    }
  }

  const persisted = await getAggregateSnapshot<HomeDashboardPayload>(key);
  if (persisted) {
    const payload = selectUsableDashboardPayload(persisted.payload);
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
