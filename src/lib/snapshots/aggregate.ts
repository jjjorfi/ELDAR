import {
  buildHomeDashboardAggregate,
  buildMacroFredAggregate,
  buildMoversAggregate,
  buildSectorSentimentAggregate
} from "@/lib/home/aggregate-builders";
import type { AggregateSnapshotContract, AggregateSnapshotKey, FreshnessClass } from "@/lib/snapshots/contracts";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";

const AGGREGATE_KEY_CANONICAL = new Map<string, AggregateSnapshotKey>(
  Object.values(AGGREGATE_SNAPSHOT_KEYS).map((key) => [key.toUpperCase(), key])
);

function canonicalAggregateKey(input: string): AggregateSnapshotKey | null {
  return AGGREGATE_KEY_CANONICAL.get(input.trim().toUpperCase()) ?? null;
}

export function isAggregateJobSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase().startsWith("@@AGG:");
}

export function aggregateJobSymbol(key: string): string {
  const canonical = canonicalAggregateKey(key);
  return `@@AGG:${canonical ?? key.trim()}`;
}

export function parseAggregateKeyFromJobSymbol(symbol: string): string | null {
  const normalized = symbol.trim();
  if (!isAggregateJobSymbol(normalized)) return null;
  const raw = normalized.slice("@@AGG:".length);
  return canonicalAggregateKey(raw) ?? raw;
}

function keyFreshnessClass(key: string): FreshnessClass {
  if (key.startsWith("home-dashboard:")) return "MARKET_INTRADAY";
  if (key === AGGREGATE_SNAPSHOT_KEYS.SECTOR_SENTIMENT_YTD) return "MARKET_INTRADAY";
  if (key === AGGREGATE_SNAPSHOT_KEYS.MOVERS_TOP3) return "MARKET_INTRADAY";
  if (key === AGGREGATE_SNAPSHOT_KEYS.MACRO_FRED) return "ANALYTICS_SCHEDULED";
  return "ANALYTICS_SCHEDULED";
}

function keyTtlMs(key: string): number {
  if (key.startsWith("home-dashboard:")) return 2 * 60_000;
  if (key === AGGREGATE_SNAPSHOT_KEYS.SECTOR_SENTIMENT_YTD) return 10 * 60_000;
  if (key === AGGREGATE_SNAPSHOT_KEYS.MOVERS_TOP3) return 60_000;
  if (key === AGGREGATE_SNAPSHOT_KEYS.MACRO_FRED) return 10 * 60_000;
  return 5 * 60_000;
}

function expiryFromBuiltAt(builtAt: string, ttlMs: number): string {
  const builtAtMs = Date.parse(builtAt);
  const startMs = Number.isFinite(builtAtMs) ? builtAtMs : Date.now();
  return new Date(startMs + ttlMs).toISOString();
}

async function buildAggregatePayloadByKey(key: string): Promise<unknown> {
  if (key === AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_YTD) return buildHomeDashboardAggregate("YTD");
  if (key === AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_1M) return buildHomeDashboardAggregate("1M");
  if (key === AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_3M) return buildHomeDashboardAggregate("3M");
  if (key === AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_6M) return buildHomeDashboardAggregate("6M");
  if (key === AGGREGATE_SNAPSHOT_KEYS.SECTOR_SENTIMENT_YTD) return buildSectorSentimentAggregate();
  if (key === AGGREGATE_SNAPSHOT_KEYS.MOVERS_TOP3) return buildMoversAggregate(3);
  if (key === AGGREGATE_SNAPSHOT_KEYS.MACRO_FRED) return buildMacroFredAggregate();
  throw new Error(`Unsupported aggregate snapshot key: ${key}`);
}

export async function buildAggregateSnapshotByKey(
  key: string,
  options: { workerId: string; jobId: string | null }
): Promise<AggregateSnapshotContract> {
  const canonicalKey = canonicalAggregateKey(key) ?? key.trim();
  const startedAt = Date.now();
  const builtAt = new Date().toISOString();
  const freshnessClass = keyFreshnessClass(canonicalKey);
  const payload = await buildAggregatePayloadByKey(canonicalKey);
  return {
    key: canonicalKey,
    schemaVersion: "aggregate-snapshot-v1",
    builtAt,
    expiresAt: expiryFromBuiltAt(builtAt, keyTtlMs(canonicalKey)),
    freshnessClass,
    state: "fresh",
    source: "aggregate-builder",
    warnings: [],
    payload,
    trace: {
      lastJobId: options.jobId,
      lastBuildMs: Date.now() - startedAt,
      builtBy: options.workerId
    }
  };
}

export function listDefaultAggregateKeys(): AggregateSnapshotKey[] {
  return [
    AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_YTD,
    AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_1M,
    AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_3M,
    AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_6M,
    AGGREGATE_SNAPSHOT_KEYS.SECTOR_SENTIMENT_YTD,
    AGGREGATE_SNAPSHOT_KEYS.MOVERS_TOP3,
    AGGREGATE_SNAPSHOT_KEYS.MACRO_FRED
  ];
}
