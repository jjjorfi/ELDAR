import {
  AdapterError,
  defaultProvenance,
  toUpperTicker
} from "@/lib/normalize/adapters/_utils";
import { checkRevenue, checkTaxRate } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalIncomeStatement } from "@/lib/normalize/types/canonical";
import type { FmpIncomeStatementRaw } from "@/lib/normalize/types/providers";

function fmpPeriodToQuarter(period: string): 1 | 2 | 3 | 4 {
  const normalized = period.toUpperCase();
  const map: Record<string, 1 | 2 | 3 | 4> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, FY: 4 };
  return map[normalized] ?? 4;
}

export function normalizeFMPIncome(raw: FmpIncomeStatementRaw, fetchedAt: string): CanonicalIncomeStatement {
  const ticker = toUpperTicker(raw.symbol);
  const imputed: string[] = [];

  const revenue = raw.revenue ?? raw.totalRevenue ?? null;
  if (revenue === null) {
    throw new AdapterError(`FMP ${ticker} income: revenue is null`);
  }

  const revenueCheck = checkRevenue(revenue, { ticker });
  if (!revenueCheck.ok || revenueCheck.value == null) {
    throw new AdapterError(`FMP ${ticker} income: ${revenueCheck.reason ?? "invalid revenue"}`);
  }

  const rawTaxRate =
    raw.incomeTaxExpense != null &&
    raw.incomeBeforeIncomeTaxes != null &&
    raw.incomeBeforeIncomeTaxes !== 0
      ? raw.incomeTaxExpense / raw.incomeBeforeIncomeTaxes
      : null;

  const effectiveTaxRate = checkTaxRate(rawTaxRate);
  if (rawTaxRate == null || effectiveTaxRate !== rawTaxRate) {
    imputed.push("effectiveTaxRate");
  }

  const ebit = raw.operatingIncome ?? raw.ebit;
  if (ebit == null) {
    throw new AdapterError(`FMP ${ticker} income: EBIT/OperatingIncome missing`);
  }

  return {
    ticker,
    periodEnd: raw.date,
    fiscalYear: Number.parseInt(raw.calendarYear ?? raw.date.slice(0, 4), 10),
    fiscalQuarter: fmpPeriodToQuarter(raw.period),
    periodType: raw.period.toUpperCase() === "FY" ? "A" : "Q",
    currency: raw.reportedCurrency ?? "USD",

    revenue: revenueCheck.value,
    costOfRevenue: raw.costOfRevenue ?? null,
    grossProfit: raw.grossProfit ?? null,

    researchDevelopment: raw.researchAndDevelopmentExpenses ?? null,
    sellingGeneralAdmin: raw.generalAndAdministrativeExpenses ?? null,
    depreciationAmortization: raw.depreciationAndAmortization ?? null,

    ebit,
    ebitda: raw.ebitda ?? null,

    interestExpense: raw.interestExpense ?? null,
    interestIncome: raw.interestIncome ?? null,
    otherNonOperating: raw.totalOtherIncomeExpensesNet ?? null,

    incomeBeforeTax: raw.incomeBeforeIncomeTaxes ?? null,
    incomeTaxExpense: raw.incomeTaxExpense ?? null,
    effectiveTaxRate,
    netIncome: raw.netIncome,
    netIncomeCommon: raw.netIncomeAvailableToCommonShareholders ?? null,

    epsDiluted: raw.epsdiluted ?? null,
    epsBasic: raw.eps ?? null,
    sharesDiluted: raw.weightedAverageShsOutDil ?? null,
    sharesBasic: raw.weightedAverageShsOut ?? null,
    dividendsPerShare: null,
    stockBasedCompensation: null,

    meta: defaultProvenance("fmp", fetchedAt, { imputed })
  };
}
