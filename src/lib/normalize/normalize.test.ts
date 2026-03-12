import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAlpaca,
  normalizeTwelveData,
  normalizeEdgarIncome,
  normalizeFRED,
  resolveField
} from "@/lib/normalize";
import type {
  AlpacaSnapshotRaw,
  EdgarParsedIncome,
  FREDResponseRaw,
  TwelveDataQuoteRaw
} from "@/lib/normalize";

function nowIso(): string {
  return new Date("2026-03-11T12:00:00.000Z").toISOString();
}

test("normalizeAlpaca produces valid CanonicalQuote", () => {
  const mockAlpacaSnapshot: AlpacaSnapshotRaw = {
    symbol: "AAPL",
    latestTrade: { p: 210.25, t: "2026-03-11T15:59:30Z", s: 100 },
    dailyBar: { o: 208.1, h: 211.0, l: 207.5, c: 210.25, v: 53200000, t: "2026-03-11T16:00:00Z" },
    prevDailyBar: { o: 206.1, h: 209.0, l: 205.5, c: 205.0, v: 50000000, t: "2026-03-10T16:00:00Z" }
  };

  const result = normalizeAlpaca(mockAlpacaSnapshot, nowIso());
  assert.equal(result.ticker, "AAPL");
  assert.ok(result.price > 1);
  assert.ok(result.changePct < 0.5);
  assert.equal(result.meta.source, "alpaca");
  assert.equal(result.meta.delayMins, 0);
});

test("normalizeTwelveData converts percent_change string correctly", () => {
  const raw: TwelveDataQuoteRaw = {
    symbol: "MSFT",
    exchange: "NASDAQ",
    close: "412.50",
    open: "408.00",
    high: "413.00",
    low: "407.50",
    volume: "31200000",
    previous_close: "403.20",
    change: "9.30",
    percent_change: "2.30",
    timestamp: 1773225600,
    is_market_open: true
  };

  const result = normalizeTwelveData(raw, nowIso());
  assert.ok(Math.abs(result.changePct - 0.023) < 1e-8);
  assert.equal(result.meta.delayMins, 15);
});

test("normalizeEdgarIncome handles missing D&A correctly", () => {
  const raw: EdgarParsedIncome = {
    ticker: "NVDA",
    periodEnd: "2025-10-31",
    fiscalYear: 2025,
    fiscalQuarter: 3,
    periodType: "Q",
    revenue: 35_000_000_000,
    costOfRevenue: 13_000_000_000,
    grossProfit: null,
    researchDevelopment: 2_000_000_000,
    sellingGeneralAdmin: 1_000_000_000,
    depreciationAmortization: null,
    ebit: 15_000_000_000,
    interestExpense: 150_000_000,
    interestIncome: 450_000_000,
    incomeBeforeTax: 15_300_000_000,
    incomeTaxExpense: 2_700_000_000,
    effectiveTaxRate: 0.176,
    netIncome: 12_600_000_000,
    netIncomeCommon: 12_600_000_000,
    epsDiluted: 2.4,
    epsBasic: 2.45,
    sharesDiluted: 5_200_000_000,
    sharesBasic: 5_140_000_000,
    dividendsPerShare: null,
    stockBasedCompensation: 700_000_000
  };

  const result = normalizeEdgarIncome(raw, nowIso());
  assert.equal(result.ebitda, null);
  assert.ok(result.meta.warnings.some((w) => w.includes("D&A not available")));
});

test("normalizeEdgarIncome falls back tax rate when invalid", () => {
  const raw: EdgarParsedIncome = {
    ticker: "TSLA",
    periodEnd: "2025-12-31",
    fiscalYear: 2025,
    fiscalQuarter: 4,
    periodType: "Q",
    revenue: 24_000_000_000,
    costOfRevenue: 19_000_000_000,
    grossProfit: 5_000_000_000,
    researchDevelopment: 1_100_000_000,
    sellingGeneralAdmin: 900_000_000,
    depreciationAmortization: 350_000_000,
    ebit: 3_000_000_000,
    interestExpense: 200_000_000,
    interestIncome: 50_000_000,
    incomeBeforeTax: -1_000_000,
    incomeTaxExpense: 100_000,
    effectiveTaxRate: -0.4,
    netIncome: 2_100_000_000,
    netIncomeCommon: 2_100_000_000,
    epsDiluted: 0.62,
    epsBasic: 0.64,
    sharesDiluted: 3_390_000_000,
    sharesBasic: 3_310_000_000,
    dividendsPerShare: null,
    stockBasedCompensation: 420_000_000
  };

  const result = normalizeEdgarIncome(raw, nowIso());
  assert.equal(result.effectiveTaxRate, 0.21);
  assert.ok(result.meta.imputed.includes("effectiveTaxRate"));
});

test("resolveField picks higher priority source", () => {
  const result = resolveField("revenue", [
    { source: "fmp", value: 383_285_000_000 },
    { source: "edgar", value: 383_285_100_000 }
  ]);
  assert.equal(result.source, "edgar");
});

test("resolveField logs warning on >1% conflict", () => {
  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes("ConflictResolver")) {
      warned = true;
    }
  };

  try {
    resolveField("revenue", [
      { source: "edgar", value: 100_000_000 },
      { source: "fmp", value: 90_000_000 }
    ]);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warned, true);
});

test("normalizeFRED converts BAMLH0A0HYM2 from percent to bps", () => {
  const raw: FREDResponseRaw = {
    observations: [{ date: "2026-03-10", value: "3.80" }],
    seriess: [{ frequency: "Daily" }]
  };

  const result = normalizeFRED(raw, "BAMLH0A0HYM2", nowIso());
  assert.equal(result.latest.value, 380);
  assert.equal(result.unit, "bps");
});

test("normalizeFRED filters out missing observations", () => {
  const raw: FREDResponseRaw = {
    observations: [
      { date: "2026-03-09", value: "." },
      { date: "2026-03-10", value: "2.10" }
    ],
    seriess: [{ frequency: "Daily" }]
  };

  const result = normalizeFRED(raw, "DFII10", nowIso());
  assert.equal(result.observations.length, 1);
  assert.equal(result.latest.value, 2.1);
});
