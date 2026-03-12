export interface SanityResult {
  ok: boolean;
  reason?: string;
  value: number | null;
}

export function checkPrice(
  price: number | null | undefined,
  context: { ticker: string; lastKnown?: number | null }
): SanityResult {
  if (price == null || !Number.isFinite(price)) {
    return { ok: false, reason: "null or non-finite", value: null };
  }

  if (price <= 0) {
    return { ok: false, reason: `non-positive price: ${price}`, value: null };
  }

  if (price < 1.0) {
    return { ok: false, reason: `below $1 minimum: ${price}`, value: null };
  }

  if (context.lastKnown != null && context.lastKnown > 0) {
    const deviation = Math.abs(price - context.lastKnown) / context.lastKnown;
    if (deviation > 0.15) {
      return {
        ok: false,
        reason: `${(deviation * 100).toFixed(1)}% deviation from last known $${context.lastKnown}`,
        value: null
      };
    }
  }

  return { ok: true, value: price };
}

export function checkChangePct(raw: number | null | undefined): SanityResult {
  if (raw == null || !Number.isFinite(raw)) return { ok: false, reason: "null", value: null };
  if (Math.abs(raw) > 0.50) {
    return { ok: false, reason: `change pct >50%: ${raw}`, value: null };
  }
  return { ok: true, value: raw };
}

export function checkRevenue(value: number | null, _context: { ticker: string }): SanityResult {
  if (value == null) return { ok: false, reason: "null", value: null };
  if (value < 0) return { ok: false, reason: `negative revenue: ${value}`, value: null };
  if (value < 10_000_000) {
    return {
      ok: false,
      reason: `Revenue $${value} looks like thousands not actuals. Did you multiply EDGAR values by 1000?`,
      value: null
    };
  }
  return { ok: true, value };
}

export function checkMargin(value: number | null, field: string): SanityResult {
  if (value == null) return { ok: true, value: null };
  if (!Number.isFinite(value)) return { ok: false, reason: "non-finite", value: null };
  if (value < -2 || value > 1) {
    return {
      ok: false,
      reason: `${field} ${(value * 100).toFixed(1)}% outside valid range [-200%, 100%]`,
      value: null
    };
  }
  return { ok: true, value };
}

export function checkTaxRate(raw: number | null): number {
  if (raw == null || !Number.isFinite(raw) || raw < 0 || raw > 0.50) {
    return 0.21;
  }
  return raw;
}

export function checkRatio(value: number | null, field: string, bounds: { min: number; max: number }): SanityResult {
  if (value == null) return { ok: true, value: null };
  if (!Number.isFinite(value)) return { ok: false, reason: `${field}: non-finite`, value: null };
  if (value < bounds.min || value > bounds.max) {
    return {
      ok: false,
      reason: `${field} ${value} outside bounds [${bounds.min}, ${bounds.max}]`,
      value: null
    };
  }
  return { ok: true, value };
}

export const MACRO_BOUNDS: Record<string, { min: number; max: number; unit: string }> = {
  MOVE: { min: 50, max: 300, unit: "index" },
  BAMLH0A0HYM2: { min: 100, max: 2000, unit: "bps" },
  DFII10: { min: -2, max: 6, unit: "percent" },
  T10Y2Y: { min: -3, max: 4, unit: "percent" },
  SAHMREALTIME: { min: -0.5, max: 3, unit: "percent" },
  VIX: { min: 9, max: 90, unit: "index" },
  DXY: { min: 70, max: 130, unit: "index" },
  CPIAUCSL_YOY: { min: -2, max: 15, unit: "percent" },
  WTI: { min: 20, max: 200, unit: "usd" },
  CU_AU_RATIO: { min: 0.001, max: 0.01, unit: "ratio" }
};

export function checkMacroValue(seriesId: string, value: number | null): SanityResult {
  if (value == null) return { ok: false, reason: "null", value: null };
  if (!Number.isFinite(value)) return { ok: false, reason: "non-finite", value: null };

  const bounds = MACRO_BOUNDS[seriesId];
  if (!bounds) return { ok: true, value };

  if (value < bounds.min || value > bounds.max) {
    return {
      ok: false,
      reason: `${seriesId} value ${value} outside expected range [${bounds.min}, ${bounds.max}] ${bounds.unit}`,
      value: null
    };
  }
  return { ok: true, value };
}
