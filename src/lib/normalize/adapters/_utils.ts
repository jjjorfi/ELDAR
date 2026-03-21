import { checkChangePct, checkPrice } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalQuote, DataProvenance, DataSource } from "@/lib/normalize/types/canonical";

/**
 * Error thrown when an upstream provider payload cannot be normalized into the
 * canonical ELDAR shape.
 */
export class AdapterError extends Error {
  /**
   * Creates a typed normalization error.
   *
   * @param message Human-readable error message for logs and tests.
   */
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

/**
 * Options used when constructing provenance metadata for normalized payloads.
 */
export interface ProvenanceOptions {
  delayMins?: number;
  stale?: boolean;
  staleMins?: number;
  conflicted?: boolean;
  imputed?: string[];
  warnings?: string[];
}

/**
 * Input contract for the shared canonical quote builder.
 */
export interface CanonicalQuoteBuildInput {
  source: DataSource;
  adapterLabel: string;
  tickerInput: string | null | undefined;
  fetchedAt: string;
  exchange: string | null;
  price: number | null | undefined;
  prevClose: number | null | undefined;
  rawChange?: number | null | undefined;
  rawChangePct?: number | null | undefined;
  rawChangePctScale?: "decimal" | "percent";
  open?: number | null | undefined;
  high?: number | null | undefined;
  low?: number | null | undefined;
  volume?: number | null | undefined;
  avgVolume?: number | null | undefined;
  marketCap?: number | null | undefined;
  sharesOut?: number | null | undefined;
  marketState: CanonicalQuote["marketState"];
  timestamp: string | number | null | undefined;
  prevCloseFieldLabel?: string;
  provenance?: ProvenanceOptions;
}

/**
 * Parses a float-like provider value into a finite number.
 *
 * @param value Raw provider field.
 * @returns Parsed finite number or null.
 */
export function parseFloatOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses an integer-like provider value into a finite number.
 *
 * @param value Raw provider field.
 * @returns Parsed finite integer or null.
 */
export function parseIntOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Math.round(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizes a ticker into uppercase ELDAR format.
 *
 * @param raw Raw provider ticker value.
 * @returns Uppercase ticker without exchange prefixes.
 * @throws AdapterError When the ticker is empty.
 */
export function toUpperTicker(raw: string | null | undefined): string {
  if (!raw || raw.trim().length === 0) {
    throw new AdapterError("ticker is null or empty");
  }

  return raw
    .trim()
    .toUpperCase()
    .replace(":NASDAQ", "")
    .replace(":NYSE", "")
    .replace("/", "-");
}

/**
 * Converts provider timestamps into ISO-8601 strings.
 *
 * @param raw Raw timestamp value.
 * @returns ISO timestamp or null when parsing fails.
 */
export function toISODate(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;

  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const parsed = new Date(ms);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/**
 * Converts a timestamp into an ISO date-only string.
 *
 * @param raw Raw timestamp value.
 * @returns `YYYY-MM-DD` string or null.
 */
export function parseDateOnly(raw: string | number | null | undefined): string | null {
  const iso = toISODate(raw);
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Builds the default provenance block attached to normalized payloads.
 *
 * @param source Upstream provider or computed source.
 * @param fetchedAt Fetch timestamp for the payload.
 * @param options Optional provenance flags.
 * @returns Canonical provenance object.
 */
export function defaultProvenance(
  source: DataSource,
  fetchedAt: string,
  options?: ProvenanceOptions
): DataProvenance {
  return {
    source,
    fetchedAt,
    delayMins: options?.delayMins ?? 0,
    stale: options?.stale ?? false,
    staleMins: options?.staleMins ?? 0,
    conflicted: options?.conflicted ?? false,
    imputed: options?.imputed ?? [],
    warnings: options?.warnings ?? []
  };
}

/**
 * Converts ratio-like values to decimal form when they arrive as percentages.
 *
 * @param value Raw ratio value.
 * @returns Decimal ratio or null.
 */
export function normalizeRatioOrNull(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) > 1) return value / 100;
  return value;
}

/**
 * Normalizes optional numeric fields to finite numbers or null.
 *
 * @param value Raw numeric field.
 * @returns Finite number or null.
 */
function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/**
 * Builds a canonical quote object with shared validation, price delta math, and
 * provenance defaults.
 *
 * @param input Provider-specific quote fields.
 * @returns Canonical quote payload.
 * @throws AdapterError When the ticker, price, or previous close are invalid.
 */
export function buildCanonicalQuote(input: CanonicalQuoteBuildInput): CanonicalQuote {
  const ticker = toUpperTicker(input.tickerInput);
  const prevClose = finiteOrNull(input.prevClose);
  if (prevClose == null || prevClose <= 0) {
    throw new AdapterError(
      `${input.adapterLabel} ${ticker}: ${input.prevCloseFieldLabel ?? "prevClose"} missing/invalid`
    );
  }

  const priceCheck = checkPrice(finiteOrNull(input.price), { ticker });
  if (!priceCheck.ok || priceCheck.value == null) {
    throw new AdapterError(
      `${input.adapterLabel} ${ticker}: price failed sanity (${priceCheck.reason ?? "unknown"})`
    );
  }

  const change = finiteOrNull(input.rawChange) ?? (priceCheck.value - prevClose);
  const computedChangePct = prevClose !== 0 ? change / prevClose : 0;
  const suppliedChangePct = finiteOrNull(input.rawChangePct);
  const normalizedSuppliedChangePct =
    suppliedChangePct == null
      ? null
      : input.rawChangePctScale === "percent"
        ? suppliedChangePct / 100
        : suppliedChangePct;
  const safeChangePct = checkChangePct(normalizedSuppliedChangePct).value ?? computedChangePct;

  return {
    ticker,
    exchange: input.exchange,
    price: priceCheck.value,
    open: finiteOrNull(input.open),
    high: finiteOrNull(input.high),
    low: finiteOrNull(input.low),
    prevClose,
    change,
    changePct: safeChangePct,
    volume: finiteOrNull(input.volume),
    avgVolume: finiteOrNull(input.avgVolume),
    marketCap: finiteOrNull(input.marketCap),
    sharesOut: finiteOrNull(input.sharesOut),
    marketState: input.marketState,
    timestamp: toISODate(input.timestamp) ?? input.fetchedAt,
    meta: defaultProvenance(input.source, input.fetchedAt, input.provenance)
  };
}
