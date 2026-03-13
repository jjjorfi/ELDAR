import {
  aggregateJobSymbol,
  buildAggregateSnapshotByKey,
  isAggregateJobSymbol,
  parseAggregateKeyFromJobSymbol
} from "@/lib/snapshots/aggregate";
import { buildSymbolSnapshot } from "@/lib/snapshots/builder";
import type {
  AggregateSnapshotContract,
  AggregateSnapshotReadResult,
  EnqueueSnapshotJobInput,
  SnapshotMetrics,
  SnapshotReadResult,
  SnapshotWorkerResult,
  SymbolSnapshotContract
} from "@/lib/snapshots/contracts";
import type { SnapshotQueuePriority } from "@/lib/snapshots/contracts";
import {
  claimSnapshotJobs,
  completeSnapshotJob,
  enqueueSnapshotJob,
  failSnapshotJob,
  getAggregateSnapshot,
  getSnapshotMetrics,
  getSymbolSnapshot,
  listDeadSnapshotJobs,
  requeueDeadSnapshotJobs,
  upsertAggregateSnapshot,
  upsertSymbolSnapshot
} from "@/lib/snapshots/store";

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function parseDateMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function staleModules(snapshot: SymbolSnapshotContract): string[] {
  const now = Date.now();
  const modules: Array<[string, string]> = [
    ["analysis", snapshot.modules.analysis.state.expiresAt],
    ["fundamentals", snapshot.modules.fundamentals.state.expiresAt],
    ["context", snapshot.modules.context.state.expiresAt],
    ["news", snapshot.modules.news.state.expiresAt]
  ];
  return modules
    .filter(([, expiresAt]) => parseDateMs(expiresAt) <= now)
    .map(([name]) => name);
}

function withFreshness(snapshot: SymbolSnapshotContract): SymbolSnapshotContract {
  const stale = staleModules(snapshot);
  const dataState = stale.length === 0 ? "fresh" : stale.length >= 3 || !snapshot.modules.analysis.data ? "degraded" : "stale";
  return {
    ...snapshot,
    quality: {
      ...snapshot.quality,
      dataState,
      staleModules: stale
    }
  };
}

export async function requestSnapshotRefresh(input: EnqueueSnapshotJobInput): Promise<{ id: string; created: boolean }> {
  return enqueueSnapshotJob({
    symbol: normalizeSymbol(input.symbol),
    priority: input.priority,
    reason: input.reason,
    requestedBy: input.requestedBy,
    payload: input.payload
  });
}

export async function requestAggregateSnapshotRefresh(input: {
  key: string;
  priority: SnapshotQueuePriority;
  reason: string;
  requestedBy: string | null;
  payload?: Record<string, unknown>;
}): Promise<{ id: string; created: boolean }> {
  return enqueueSnapshotJob({
    symbol: aggregateJobSymbol(input.key),
    priority: input.priority,
    reason: input.reason,
    requestedBy: input.requestedBy,
    payload: input.payload
  });
}

export interface ReadSnapshotInput {
  symbol: string;
  priority: SnapshotQueuePriority;
  reason: string;
  requestedBy: string | null;
}

/**
 * Queues a symbol snapshot refresh for later worker execution.
 *
 * The request path only schedules work; it never builds snapshots inline.
 */
export async function getSnapshotForRead(input: ReadSnapshotInput): Promise<SnapshotReadResult> {
  const normalized = normalizeSymbol(input.symbol);
  const snapshot = await getSymbolSnapshot(normalized);
  if (!snapshot) {
    const enqueued = await requestSnapshotRefresh({
      symbol: normalized,
      priority: input.priority,
      reason: input.reason,
      requestedBy: input.requestedBy,
      payload: {}
    });
    return {
      snapshot: null,
      state: "missing",
      enqueued: enqueued.created
    };
  }

  const hydrated = withFreshness(snapshot);
  if (hydrated.quality.staleModules.length > 0) {
    const enqueued = await requestSnapshotRefresh({
      symbol: normalized,
      priority: input.priority,
      reason: `${input.reason}: stale ${hydrated.quality.staleModules.join(",")}`,
      requestedBy: input.requestedBy,
      payload: {}
    });
    return {
      snapshot: hydrated,
      state: "stale",
      enqueued: enqueued.created
    };
  }

  return {
    snapshot: hydrated,
    state: "fresh",
    enqueued: false
  };
}

/**
 * Reads an aggregate snapshot and queues a refresh when it is missing or stale.
 *
 * User-facing routes must stay cache/DB-only, so this read path never rebuilds
 * aggregates inline.
 */
export async function getAggregateSnapshotForRead<T = unknown>(input: {
  key: string;
  priority: SnapshotQueuePriority;
  reason: string;
  requestedBy: string | null;
}): Promise<AggregateSnapshotReadResult<T>> {
  const key = input.key.trim();
  const snapshot = await getAggregateSnapshot<T>(key);
  if (!snapshot) {
    const enqueued = await requestAggregateSnapshotRefresh({
      key,
      priority: input.priority,
      reason: input.reason,
      requestedBy: input.requestedBy,
      payload: {}
    });
    return {
      snapshot: null,
      state: "missing",
      enqueued: enqueued.created
    };
  }

  const expiresAtMs = parseDateMs(snapshot.expiresAt);
  const stale = !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
  if (stale) {
    const enqueued = await requestAggregateSnapshotRefresh({
      key,
      priority: input.priority,
      reason: `${input.reason}: stale aggregate`,
      requestedBy: input.requestedBy,
      payload: {}
    });
    return {
      snapshot: {
        ...snapshot,
        state: "stale"
      } as AggregateSnapshotContract<T>,
      state: "stale",
      enqueued: enqueued.created
    };
  }

  return {
    snapshot,
    state: "fresh",
    enqueued: false
  };
}

export async function processSnapshotJobs(batchSize = 10, workerId = "snapshot-worker"): Promise<SnapshotWorkerResult> {
  const startedAt = Date.now();
  const claimedJobs = await claimSnapshotJobs(batchSize, workerId);
  let succeeded = 0;
  let retried = 0;
  let deadLettered = 0;
  let failed = 0;
  const processedSymbols: string[] = [];

  for (const job of claimedJobs) {
    try {
      if (isAggregateJobSymbol(job.symbol)) {
        const key = parseAggregateKeyFromJobSymbol(job.symbol);
        if (!key) {
          throw new Error(`Invalid aggregate job symbol: ${job.symbol}`);
        }
        const aggregate = await buildAggregateSnapshotByKey(key, {
          workerId,
          jobId: job.id
        });
        await upsertAggregateSnapshot(aggregate);
      } else {
        const snapshot = await buildSymbolSnapshot(job.symbol, {
          workerId,
          jobId: job.id
        });
        await upsertSymbolSnapshot(snapshot);
      }
      await completeSnapshotJob(job.id);
      succeeded += 1;
      processedSymbols.push(job.symbol);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const result = await failSnapshotJob(job.id, message);
      if (result === "dead") {
        deadLettered += 1;
      } else {
        retried += 1;
      }
    }
  }

  return {
    workerId,
    claimed: claimedJobs.length,
    succeeded,
    retried,
    deadLettered,
    failed,
    durationMs: Date.now() - startedAt,
    processedSymbols
  };
}

export async function getSnapshotOpsMetrics(): Promise<SnapshotMetrics> {
  return getSnapshotMetrics();
}

export async function getDeadSnapshotJobs(limit = 100) {
  return listDeadSnapshotJobs(limit);
}

export async function replayDeadSnapshotJobs(options?: { limit?: number; symbol?: string | null; jobIds?: string[] }) {
  return requeueDeadSnapshotJobs(options);
}
