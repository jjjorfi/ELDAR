import assert from "node:assert/strict";
import test from "node:test";

import type { QuarterlyCashFlow, QuarterlyIncome } from "@/lib/financials/eldar-financials-types";
import * as financialsPipelineModule from "@/lib/financials/eldar-financials-pipeline";
import * as secCompanyfactsModule from "@/lib/market/providers/sec-companyfacts";

const pipelineTest = financialsPipelineModule.__test__;
const secFallbackTest = secCompanyfactsModule.__test__;

function makeIncome(
  fiscalQuarter: 1 | 2 | 3 | 4,
  periodEnd: string,
  formType: "10-Q" | "10-K",
  revenue: number,
  netIncome: number,
  epsDiluted: number
): QuarterlyIncome {
  return {
    fiscalYear: 2025,
    fiscalQuarter,
    periodEnd,
    formType,
    filedDate: periodEnd,
    revenue,
    costOfRevenue: null,
    grossProfit: null,
    grossMargin: null,
    researchDevelopment: null,
    sellingGeneralAdmin: null,
    depreciationAmortization: null,
    stockBasedCompensation: null,
    ebit: revenue * 0.2,
    ebitda: null,
    ebitMargin: null,
    ebitdaMargin: null,
    interestExpense: null,
    interestIncome: null,
    netInterestExpense: null,
    incomeBeforeTax: null,
    incomeTaxExpense: null,
    effectiveTaxRate: null,
    netIncome,
    netMargin: null,
    epsDiluted,
    epsBasic: epsDiluted,
    sharesDiluted: 100,
    sharesBasic: 100,
    dividendsPerShare: null
  };
}

function makeCashflow(
  fiscalQuarter: 1 | 2 | 3 | 4,
  periodEnd: string,
  operatingCashFlow: number,
  capex: number
): QuarterlyCashFlow {
  const freeCashFlow = operatingCashFlow - Math.abs(capex);
  return {
    fiscalYear: 2025,
    fiscalQuarter,
    periodEnd,
    operatingCashFlow,
    depreciationAmortization: null,
    stockBasedCompensation: null,
    capex,
    acquisitions: null,
    purchasesOfInvestments: null,
    salesOfInvestments: null,
    investingCashFlow: null,
    debtIssuance: null,
    debtRepayment: null,
    shareIssuance: null,
    shareBuybacks: null,
    dividendsPaid: null,
    financingCashFlow: null,
    freeCashFlow,
    fcfMargin: null,
    fcfConversion: null
  };
}

test("normalizeAnnualQ4Flows converts cumulative cash flows and annual EPS into discrete quarters", () => {
  const incomeRows: QuarterlyIncome[] = [
    makeIncome(1, "2024-12-28", "10-Q", 100, 25, 1.0),
    makeIncome(2, "2025-03-29", "10-Q", 110, 30, 1.1),
    makeIncome(3, "2025-06-28", "10-Q", 120, 35, 1.2),
    makeIncome(4, "2025-09-27", "10-K", 460, 140, 4.6)
  ];
  const cashflowRows: QuarterlyCashFlow[] = [
    makeCashflow(1, "2024-12-28", 40, 5),
    makeCashflow(2, "2025-03-29", 90, 12),
    makeCashflow(3, "2025-06-28", 150, 21),
    makeCashflow(4, "2025-09-27", 220, 32)
  ];

  const normalized = pipelineTest.normalizeAnnualQ4Flows(incomeRows, cashflowRows, []);

  assert.equal(normalized.income[3]?.revenue, 130);
  assert.equal(normalized.income[3]?.netIncome, 50);
  assert.ok(Math.abs((normalized.income[3]?.epsDiluted ?? 0) - 1.3) < 1e-9);

  assert.equal(normalized.cashflow[1]?.operatingCashFlow, 50);
  assert.equal(normalized.cashflow[1]?.capex, 7);
  assert.equal(normalized.cashflow[1]?.freeCashFlow, 43);

  assert.equal(normalized.cashflow[2]?.operatingCashFlow, 60);
  assert.equal(normalized.cashflow[2]?.capex, 9);
  assert.equal(normalized.cashflow[2]?.freeCashFlow, 51);

  assert.equal(normalized.cashflow[3]?.operatingCashFlow, 70);
  assert.equal(normalized.cashflow[3]?.capex, 11);
  assert.equal(normalized.cashflow[3]?.freeCashFlow, 59);
});

test("SEC companyfacts fallback derives discrete quarter growth and TTM values from cumulative 10-Q rows", () => {
  const payload = {
    facts: {
      dei: {
        EntityCommonStockSharesOutstanding: {
          units: {
            shares: [{ end: "2025-12-27", val: 1000 }]
          }
        }
      },
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              { start: "2024-09-29", end: "2024-12-28", val: 120, form: "10-Q", fp: "Q1", filed: "2025-01-31", frame: "CY2024Q4" },
              { start: "2024-09-29", end: "2025-03-29", val: 210, form: "10-Q", fp: "Q2", filed: "2025-05-02" },
              { start: "2024-12-29", end: "2025-03-29", val: 90, form: "10-Q", fp: "Q2", filed: "2025-05-02", frame: "CY2025Q1" },
              { start: "2024-09-29", end: "2025-06-28", val: 330, form: "10-Q", fp: "Q3", filed: "2025-08-01" },
              { start: "2025-03-30", end: "2025-06-28", val: 120, form: "10-Q", fp: "Q3", filed: "2025-08-01", frame: "CY2025Q2" },
              { start: "2024-09-29", end: "2025-09-27", val: 470, form: "10-K", fp: "FY", filed: "2025-10-31", frame: "CY2025" },
              { start: "2025-09-28", end: "2025-12-27", val: 140, form: "10-Q", fp: "Q1", filed: "2026-01-30", frame: "CY2025Q4" }
            ]
          }
        },
        EarningsPerShareDiluted: {
          units: {
            "USD/shares": [
              { start: "2024-09-29", end: "2024-12-28", val: 1.2, form: "10-Q", fp: "Q1", filed: "2025-01-31", frame: "CY2024Q4" },
              { start: "2024-09-29", end: "2025-03-29", val: 2.2, form: "10-Q", fp: "Q2", filed: "2025-05-02" },
              { start: "2024-12-29", end: "2025-03-29", val: 1.0, form: "10-Q", fp: "Q2", filed: "2025-05-02", frame: "CY2025Q1" },
              { start: "2024-09-29", end: "2025-06-28", val: 3.4, form: "10-Q", fp: "Q3", filed: "2025-08-01" },
              { start: "2025-03-30", end: "2025-06-28", val: 1.2, form: "10-Q", fp: "Q3", filed: "2025-08-01", frame: "CY2025Q2" },
              { start: "2024-09-29", end: "2025-09-27", val: 4.8, form: "10-K", fp: "FY", filed: "2025-10-31", frame: "CY2025" },
              { start: "2025-09-28", end: "2025-12-27", val: 1.6, form: "10-Q", fp: "Q1", filed: "2026-01-30", frame: "CY2025Q4" }
            ]
          }
        },
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              { start: "2024-09-29", end: "2024-12-28", val: 40, form: "10-Q", fp: "Q1", filed: "2025-01-31", frame: "CY2024Q4" },
              { start: "2024-09-29", end: "2025-03-29", val: 90, form: "10-Q", fp: "Q2", filed: "2025-05-02" },
              { start: "2024-09-29", end: "2025-06-28", val: 150, form: "10-Q", fp: "Q3", filed: "2025-08-01" },
              { start: "2024-09-29", end: "2025-09-27", val: 220, form: "10-K", fp: "FY", filed: "2025-10-31", frame: "CY2025" },
              { start: "2025-09-28", end: "2025-12-27", val: 80, form: "10-Q", fp: "Q1", filed: "2026-01-30", frame: "CY2025Q4" }
            ]
          }
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: {
            USD: [
              { start: "2024-09-29", end: "2024-12-28", val: 5, form: "10-Q", fp: "Q1", filed: "2025-01-31", frame: "CY2024Q4" },
              { start: "2024-09-29", end: "2025-03-29", val: 12, form: "10-Q", fp: "Q2", filed: "2025-05-02" },
              { start: "2024-09-29", end: "2025-06-28", val: 21, form: "10-Q", fp: "Q3", filed: "2025-08-01" },
              { start: "2024-09-29", end: "2025-09-27", val: 32, form: "10-K", fp: "FY", filed: "2025-10-31", frame: "CY2025" },
              { start: "2025-09-28", end: "2025-12-27", val: 13, form: "10-Q", fp: "Q1", filed: "2026-01-30", frame: "CY2025Q4" }
            ]
          }
        }
      }
    }
  };

  const fallback = secFallbackTest.buildFallbackFromFacts(payload);

  assert.equal(fallback.revenueGrowth?.toFixed(6), (140 / 120 - 1).toFixed(6));
  assert.equal(fallback.earningsQuarterlyGrowth?.toFixed(6), (1.6 / 1.2 - 1).toFixed(6));
  assert.equal(fallback.trailingEpsTtm, 5.2);
  assert.equal(fallback.ttmFreeCashflow, 212);
  assert.equal(fallback.sharesOutstanding, 1000);
});

test("deriveFiscalQuarter handles early-month 52/53-week fiscal year ends", () => {
  assert.equal(pipelineTest.deriveFiscalQuarter("2024-12-28", "10-03"), 1);
  assert.equal(pipelineTest.deriveFiscalQuarter("2025-03-29", "10-03"), 2);
  assert.equal(pipelineTest.deriveFiscalQuarter("2025-06-28", "10-03"), 3);
  assert.equal(pipelineTest.deriveFiscalQuarter("2025-09-27", "10-03"), 4);
  assert.equal(pipelineTest.deriveFiscalYear("2024-12-28", "10-03"), 2025);
});

test("safeGrowth suppresses sign-crossing and near-zero earnings growth blowups", () => {
  assert.equal(pipelineTest.safeGrowth(1.02, -0.03), null);
  assert.equal(pipelineTest.safeGrowth(-6.35, -0.38), null);
  assert.equal(pipelineTest.safeGrowth(1.34, 1.4)?.toFixed(6), (-0.04285714285714286).toFixed(6));
});

test("SEC companyfacts fallback prefers quarter-like frames over annual FY rows", () => {
  const rows = [
    { start: "2024-09-01", end: "2024-11-30", val: 3.59, fp: "Q1", form: "10-Q", filed: "2024-12-19" },
    { start: "2024-09-01", end: "2025-02-28", val: 6.42, fp: "Q2", form: "10-Q", filed: "2025-03-20" },
    { start: "2024-12-01", end: "2025-02-28", val: 2.82, fp: "Q2", form: "10-Q", filed: "2025-03-20" },
    { start: "2024-09-01", end: "2025-05-31", val: 9.9, fp: "Q3", form: "10-Q", filed: "2025-06-20" },
    { start: "2025-03-01", end: "2025-05-31", val: 3.49, fp: "Q3", form: "10-Q", filed: "2025-06-20" },
    { start: "2024-09-01", end: "2025-08-31", val: 12.15, fp: "FY", form: "10-K", filed: "2025-10-10", frame: "CY2025" },
    { start: "2025-06-01", end: "2025-08-31", val: 2.25, fp: "FY", form: "10-K", filed: "2025-10-10", frame: "CY2025Q3" },
    { start: "2025-09-01", end: "2025-11-30", val: 3.54, fp: "Q1", form: "10-Q", filed: "2025-12-18", frame: "CY2025Q4" }
  ];

  const normalized = secFallbackTest.normalizeQuarterSeries(rows);

  assert.deepEqual(
    normalized.slice(-4).map((row) => Number((row.val ?? 0).toFixed(2))),
    [2.83, 3.48, 2.25, 3.54]
  );
});
