import { parseTimestampMs } from "@/lib/market/adapter-utils";

export interface PriceObservation {
  source: string;
  price: number | null;
  timestampMs: number | null;
  baseWeight: number;
}

export interface PriceMergeWarning {
  type:
    | "DataMismatchWarning"
    | "SourceDivergenceWarning"
    | "StaleSourceWeightReduced"
    | "AntiFlashCrashVeto"
    | "AllSourcesExcludedFallback";
  message: string;
  source?: string;
}

export interface PriceMergeResult {
  value: number | null;
  warnings: PriceMergeWarning[];
  usedSources: string[];
  excludedSources: string[];
}

interface WeightedObservation {
  source: string;
  price: number;
  timestampMs: number | null;
  weight: number;
}

const DIVERGENCE_THRESHOLD = 0.02;
const FLASH_CRASH_THRESHOLD = 0.15;
const STALE_MS = 30_000;

/**
 * Validates that a candidate value is a finite positive price.
 *
 * @param value Candidate numeric value.
 * @returns Finite positive price or null.
 */
function toFinitePrice(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Normalizes mixed timestamp units (sec/ms/ns) into epoch milliseconds.
 *
 * @param value Raw timestamp.
 * @returns Epoch milliseconds or null.
 */
function normalizeTimestampMs(value: number | null): number | null {
  return parseTimestampMs(value);
}

/**
 * Computes the statistical median of a numeric list.
 *
 * @param values Input values.
 * @returns Median value or NaN when input is empty.
 */
function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Computes weighted median from weighted observations.
 *
 * @param observations Candidate observations with weights.
 * @returns Weighted median price or null.
 */
function weightedMedian(observations: WeightedObservation[]): number | null {
  if (observations.length === 0) return null;

  const sorted = [...observations].sort((a, b) => a.price - b.price);
  const totalWeight = sorted.reduce((sum, row) => sum + row.weight, 0);

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return median(sorted.map((row) => row.price));
  }

  const threshold = totalWeight / 2;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= threshold) {
      return row.price;
    }
  }

  return sorted.at(-1)?.price ?? null;
}

/**
 * Computes absolute relative difference between two values.
 *
 * @param a First value.
 * @param b Second value (reference denominator).
 * @returns Relative absolute difference.
 */
function relativeDiff(a: number, b: number): number {
  const denominator = Math.max(Math.abs(b), 1e-9);
  return Math.abs(a - b) / denominator;
}

/**
 * Merges multi-provider price observations with staleness/divergence/flash-crash protections.
 *
 * @param params Merge parameters including observations and optional last known good value.
 * @returns Final merged price plus warning metadata.
 */
export function mergePriceObservations(params: {
  symbol: string;
  observations: PriceObservation[];
  lastKnownGoodPrice?: number | null;
}): PriceMergeResult {
  const warnings: PriceMergeWarning[] = [];

  const valid: WeightedObservation[] = params.observations
    .map((row) => {
      const price = toFinitePrice(row.price);
      if (price === null) return null;
      return {
        source: row.source,
        price,
        timestampMs: normalizeTimestampMs(row.timestampMs),
        weight: row.baseWeight > 0 ? row.baseWeight : 0.01
      };
    })
    .filter((row): row is WeightedObservation => row !== null);

  if (valid.length === 0) {
    return {
      value: null,
      warnings,
      usedSources: [],
      excludedSources: []
    };
  }

  const newestTimestamp = valid.reduce<number | null>((acc, row) => {
    if (row.timestampMs === null) return acc;
    if (acc === null || row.timestampMs > acc) return row.timestampMs;
    return acc;
  }, null);

  for (const row of valid) {
    if (newestTimestamp !== null && row.timestampMs !== null) {
      if (newestTimestamp - row.timestampMs > STALE_MS) {
        row.weight = Math.min(row.weight, 0.1);
        warnings.push({
          type: "StaleSourceWeightReduced",
          source: row.source,
          message: `Source ${row.source} marked stale (>30s old) for ${params.symbol}; weight reduced to ${row.weight.toFixed(2)}.`
        });
      } else if (row.timestampMs === newestTimestamp) {
        row.weight *= 1.15;
      }
    }
  }

  const excluded = new Set<string>();

  if (valid.length >= 3) {
    for (let index = 0; index < valid.length; index += 1) {
      const current = valid[index];
      const peers = valid.filter((_, i) => i !== index).map((row) => row.price);
      const peerMedian = median(peers);
      if (!Number.isFinite(peerMedian)) continue;

      if (relativeDiff(current.price, peerMedian) > DIVERGENCE_THRESHOLD) {
        excluded.add(current.source);
        warnings.push({
          type: "SourceDivergenceWarning",
          source: current.source,
          message: `Source ${current.source} excluded for ${params.symbol}; diverged >2% vs peer median.`
        });
      }
    }
  }

  let candidates = valid.filter((row) => !excluded.has(row.source));

  if (candidates.length === 0) {
    warnings.push({
      type: "AllSourcesExcludedFallback",
      message: `All sources were excluded for ${params.symbol}; reverting to full candidate set.`
    });
    candidates = valid;
    excluded.clear();
  }

  if (candidates.length >= 2) {
    const prices = candidates.map((row) => row.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const med = median(prices);

    if (Number.isFinite(med) && med > 0 && (max - min) / med > DIVERGENCE_THRESHOLD) {
      warnings.push({
        type: "DataMismatchWarning",
        message: `Price sources disagree by >2% for ${params.symbol}; weighted median applied.`
      });
    }
  }

  const lkg = toFinitePrice(params.lastKnownGoodPrice ?? null);
  if (lkg !== null && candidates.length > 0) {
    const allDeviate = candidates.every((row) => relativeDiff(row.price, lkg) > FLASH_CRASH_THRESHOLD);
    if (allDeviate) {
      warnings.push({
        type: "AntiFlashCrashVeto",
        message: `All live sources deviated >15% from last-known-good for ${params.symbol}; using last-known-good price.`
      });
      return {
        value: lkg,
        warnings,
        usedSources: [],
        excludedSources: Array.from(excluded)
      };
    }
  }

  const merged = weightedMedian(candidates);

  return {
    value: merged,
    warnings,
    usedSources: candidates.map((row) => row.source),
    excludedSources: Array.from(excluded)
  };
}
