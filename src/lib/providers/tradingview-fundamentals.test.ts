import { describe, expect, it } from "vitest";

import { __test__, analystRecToScore } from "@/lib/providers/tradingview-fundamentals";

describe("analystRecToScore", () => {
  it("supports live TradingView recommendation scale -1..1", () => {
    expect(analystRecToScore(1)).toBe(10);
    expect(analystRecToScore(0)).toBe(5);
    expect(analystRecToScore(-1)).toBe(0);
  });

  it("supports legacy 1..5 guidance from older TradingView examples", () => {
    expect(analystRecToScore(3)).toBe(5);
    expect(analystRecToScore(5)).toBe(0);
  });

  it("returns null for null input", () => {
    expect(analystRecToScore(null)).toBeNull();
  });

  it("clamps legacy values above 5", () => {
    expect(analystRecToScore(6)).toBe(0);
  });
});

describe("mapRow null handling", () => {
  it("returns null for empty string fields", () => {
    const row = buildSyntheticRow({ 17: "" });
    const result = __test__.mapRow(row);
    expect(result.freeCashFlowTTM).toBeNull();
  });

  it("returns null for undefined fields", () => {
    const row = buildSyntheticRow({ 17: undefined });
    const result = __test__.mapRow(row);
    expect(result.freeCashFlowTTM).toBeNull();
  });

  it("returns null for NaN fields", () => {
    const row = buildSyntheticRow({ 17: Number.NaN });
    const result = __test__.mapRow(row);
    expect(result.freeCashFlowTTM).toBeNull();
  });

  it("correctly maps positive FCF", () => {
    const row = buildSyntheticRow({ 17: 3_500_000_000 });
    const result = __test__.mapRow(row);
    expect(result.freeCashFlowTTM).toBe(3_500_000_000);
  });

  it("strips exchange prefix from ticker", () => {
    const row = buildSyntheticRow({ 0: "NASDAQ:AAPL" }, "NASDAQ:AAPL");
    const result = __test__.mapRow(row);
    expect(result.ticker).toBe("AAPL");
  });

  it("computes forwardPE correctly", () => {
    const row = buildSyntheticRow({ 1: 200, 5: 10 });
    const result = __test__.mapRow(row);
    expect(result.forwardPE).toBe(20);
  });

  it("returns null forwardPE when epsForward is zero", () => {
    const row = buildSyntheticRow({ 1: 200, 5: 0 });
    const result = __test__.mapRow(row);
    expect(result.forwardPE).toBeNull();
  });

  it("normalizes percentage fields to decimals", () => {
    const row = buildSyntheticRow({ 9: 47.5, 15: 12.5, 28: 0.45 });
    const result = __test__.mapRow(row);
    expect(result.grossMarginPct).toBeCloseTo(0.475);
    expect(result.revenueGrowthYoYPct).toBeCloseTo(0.125);
    expect(result.dividendYieldPct).toBeCloseTo(0.0045);
  });
});

function buildSyntheticRow(overrides: Record<number, unknown> = {}, symbol = "NASDAQ:TEST") {
  const defaults = new Array(35).fill(null);
  defaults[0] = "TEST";
  defaults[1] = 100;
  Object.entries(overrides).forEach(([index, value]) => {
    defaults[Number(index)] = value;
  });
  return { s: symbol, d: defaults };
}
