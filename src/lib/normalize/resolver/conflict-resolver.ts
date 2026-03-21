import type { DataSource } from "@/lib/normalize/types/canonical";
import { log } from "@/lib/logger";

/**
 * Source-priority map used when multiple providers offer the same canonical
 * field.
 */
export const PRIORITY: Record<string, DataSource[]> = {
  revenue: ["edgar", "fmp", "simfin", "finnhub_fundamentals"],
  costOfRevenue: ["edgar", "fmp", "simfin"],
  grossProfit: ["computed", "edgar", "fmp", "simfin"],
  ebit: ["edgar", "fmp", "simfin"],
  ebitda: ["computed", "fmp", "simfin"],
  netIncome: ["edgar", "fmp", "simfin", "finnhub_fundamentals"],
  operatingCashFlow: ["edgar", "fmp", "simfin"],
  capex: ["edgar", "fmp", "simfin"],
  freeCashFlow: ["computed", "edgar", "fmp"],
  totalDebt: ["computed", "edgar", "fmp"],
  investedCapital: ["computed"],

  price: ["alpaca", "tradier", "twelve_data", "finnhub", "yahoo"],
  prevClose: ["alpaca", "tradier", "twelve_data", "finnhub", "yahoo"],
  volume: ["alpaca", "tradier", "twelve_data", "finnhub"],

  MOVE: ["yahoo_macro", "fred"],
  BAMLH0A0HYM2: ["fred"],
  DFII10: ["fred"],
  T10Y2Y: ["fred"],
  SAHMREALTIME: ["fred"],
  VIX: ["yahoo_macro", "fred"],
  DXY: ["yahoo_macro", "fred"],
  CPIAUCSL: ["fred"],
  WTI: ["yahoo_macro", "fred"]
};

const CONFLICT_THRESHOLDS: Record<string, number> = {
  price: 0.005,
  revenue: 0.01,
  netIncome: 0.02,
  ebitda: 0.05,
  default: 0.01
};

export interface ResolvedValue {
  value: number | null;
  source: DataSource;
  conflicted: boolean;
  conflictDetails: string | null;
}

/**
 * Resolves a canonical field from multiple provider candidates using the
 * configured source priority and conflict thresholds.
 *
 * @param field Canonical field name being resolved.
 * @param candidates Candidate values from different sources.
 * @returns Winning value with provenance and conflict metadata.
 */
export function resolveField(
  field: string,
  candidates: { source: DataSource; value: number | null }[]
): ResolvedValue {
  const priority = PRIORITY[field] ?? ["edgar", "fmp", "alpaca", "computed"];
  const threshold = CONFLICT_THRESHOLDS[field] ?? CONFLICT_THRESHOLDS.default;

  let winner: { source: DataSource; value: number } | null = null;
  let conflicted = false;
  let conflictDetails: string | null = null;

  for (const sourceName of priority) {
    const candidate = candidates.find(
      (c) => c.source === sourceName && c.value !== null && Number.isFinite(c.value)
    );
    if (!candidate || candidate.value == null) continue;

    if (winner === null) {
      winner = { source: sourceName, value: candidate.value };
      continue;
    }

    const denom = Math.max(Math.abs(winner.value), Number.EPSILON);
    const deviation = Math.abs(candidate.value - winner.value) / denom;
    if (deviation > threshold) {
      conflicted = true;
      conflictDetails =
        `[ConflictResolver] [${field}] ${winner.source}=${winner.value} vs ` +
        `${candidate.source}=${candidate.value} ` +
        `(${(deviation * 100).toFixed(2)}% diff) — ${winner.source} wins`;
      log({
        level: "warn",
        service: "conflict-resolver",
        message: conflictDetails
      });
    }
    break;
  }

  if (winner === null) {
    const anyValid = candidates.find((c) => c.value !== null && Number.isFinite(c.value));
    if (anyValid?.value != null) {
      winner = { source: anyValid.source, value: anyValid.value };
    }
  }

  return {
    value: winner?.value ?? null,
    source: winner?.source ?? "computed",
    conflicted,
    conflictDetails
  };
}
