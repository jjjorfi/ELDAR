import type { PersistedAnalysis } from "@/lib/types";

export const SYMBOL_SNAPSHOT_SCHEMA_VERSION = "symbol-snapshot-v1";
export const SNAPSHOT_BUILDER_VERSION = "snapshot-builder-v1";

export type FreshnessClass =
  | "MARKET_LIVE"
  | "MARKET_INTRADAY"
  | "FUNDAMENTALS_DAILY"
  | "SEC_EVENT"
  | "ANALYTICS_SCHEDULED";

export const FRESHNESS_CLASS_TTL_MS: Record<FreshnessClass, number> = {
  MARKET_LIVE: 30_000,
  MARKET_INTRADAY: 5 * 60_000,
  FUNDAMENTALS_DAILY: 24 * 60 * 60_000,
  SEC_EVENT: 24 * 60 * 60_000,
  ANALYTICS_SCHEDULED: 60 * 60_000
};

export type SnapshotQueuePriority =
  | "hot"
  | "portfolio"
  | "watchlist"
  | "scheduled"
  | "repair";

export const SNAPSHOT_PRIORITY_SCORE: Record<SnapshotQueuePriority, number> = {
  hot: 100,
  portfolio: 80,
  watchlist: 60,
  scheduled: 40,
  repair: 20
};

export interface SnapshotNewsItem {
  headline: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
}

export interface SnapshotContextPeer {
  symbol: string;
  companyName: string;
}

export interface SnapshotContextModule {
  sector: string;
  sectorAverageScore: number | null;
  similarStocks: SnapshotContextPeer[];
}

export interface SnapshotFundamentalsModule {
  cik: string;
  sector: string;
  confidence: "high" | "medium" | "low";
  warningsCount: number;
  imputedCount: number;
  latestPeriodEnd: string | null;
  pricesSource: string;
  asOf: string;
}

export interface SnapshotModuleState {
  freshnessClass: FreshnessClass;
  source: string;
  builtAt: string;
  expiresAt: string;
  warnings: string[];
}

export interface SnapshotModuleEnvelope<T> {
  state: SnapshotModuleState;
  data: T | null;
}

export interface SymbolSnapshotContract {
  schemaVersion: string;
  builderVersion: string;
  symbol: string;
  asOf: string;
  modules: {
    analysis: SnapshotModuleEnvelope<PersistedAnalysis>;
    fundamentals: SnapshotModuleEnvelope<SnapshotFundamentalsModule>;
    context: SnapshotModuleEnvelope<SnapshotContextModule>;
    news: SnapshotModuleEnvelope<SnapshotNewsItem[]>;
  };
  quality: {
    dataState: "fresh" | "stale" | "degraded";
    staleModules: string[];
    warnings: string[];
  };
  trace: {
    lastJobId: string | null;
    lastBuildMs: number | null;
    builtBy: string | null;
  };
}

export interface SnapshotReadResult {
  snapshot: SymbolSnapshotContract | null;
  state: "fresh" | "stale" | "missing";
  enqueued: boolean;
}

export interface EnqueueSnapshotJobInput {
  symbol: string;
  priority: SnapshotQueuePriority;
  reason: string;
  requestedBy: string | null;
  payload?: Record<string, unknown>;
}

export interface SnapshotJobRecord {
  id: string;
  symbol: string;
  priority: number;
  status: "queued" | "running" | "done" | "dead";
  reason: string;
  requestedBy: string | null;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  lockedBy: string | null;
  lockedAt: string | null;
  lastError: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotWorkerResult {
  workerId: string;
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  failed: number;
  durationMs: number;
  processedSymbols: string[];
}

export interface SnapshotMetrics {
  queue: {
    queued: number;
    running: number;
    dead: number;
    avgQueuedAgeSec?: number;
  };
  snapshots: {
    total: number;
    stale: number;
    p50BuildMs?: number;
    p95BuildMs?: number;
  };
}

export interface AggregateSnapshotContract<T = unknown> {
  key: string;
  schemaVersion: string;
  builtAt: string;
  expiresAt: string;
  freshnessClass: FreshnessClass;
  state: "fresh" | "stale" | "degraded";
  source: string;
  warnings: string[];
  payload: T;
  trace: {
    lastJobId: string | null;
    lastBuildMs: number | null;
    builtBy: string | null;
  };
}

export interface AggregateSnapshotReadResult<T = unknown> {
  snapshot: AggregateSnapshotContract<T> | null;
  state: "fresh" | "stale" | "missing";
  enqueued: boolean;
}

export const AGGREGATE_JOB_PREFIX = "@@AGG:";

export const AGGREGATE_SNAPSHOT_KEYS = {
  HOME_DASHBOARD_YTD: "home-dashboard:YTD",
  HOME_DASHBOARD_1M: "home-dashboard:1M",
  HOME_DASHBOARD_3M: "home-dashboard:3M",
  HOME_DASHBOARD_6M: "home-dashboard:6M",
  INDICES_YTD: "indices-ytd:v1",
  MAG7_LIVE: "mag7:live:v1",
  MAG7_HOME: "mag7:home:v1",
  SECTOR_SENTIMENT_YTD: "sector-sentiment:YTD",
  MOVERS_TOP3: "movers:top3",
  EARNINGS: "earnings:v1",
  MACRO_FRED: "macro-fred:v1"
} as const;

export type AggregateSnapshotKey = (typeof AGGREGATE_SNAPSHOT_KEYS)[keyof typeof AGGREGATE_SNAPSHOT_KEYS];
