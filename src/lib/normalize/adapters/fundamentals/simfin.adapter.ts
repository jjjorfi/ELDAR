import { AdapterError, defaultProvenance, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkRevenue, checkTaxRate } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalIncomeStatement } from "@/lib/normalize/types/canonical";
import type { SimfinIncomeStatementRaw } from "@/lib/normalize/types/providers";

function simfinPeriodToQuarter(period: string): 1 | 2 | 3 | 4 {
  const normalized = period.toUpperCase();
  if (normalized.endsWith("Q1")) return 1;
  if (normalized.endsWith("Q2")) return 2;
  if (normalized.endsWith("Q3")) return 3;
  return 4;
}

export function normalizeSimfinIncome(raw: SimfinIncomeStatementRaw, fetchedAt: string): CanonicalIncomeStatement {
  const ticker = toUpperTicker(raw.ticker);

  if (raw.revenue == null) {
    throw new AdapterError(`SimFin ${ticker} income: revenue is null`);
  }

  // SimFin commonly reports thousands; convert to actuals here.
  const revenueActual = raw.revenue * 1000;
  const costOfRevenueActual = raw.costRevenue != null ? raw.costRevenue * 1000 : null;
  const grossProfitActual = raw.grossProfit != null ? raw.grossProfit * 1000 : null;
  const operatingIncomeActual = raw.operatingIncome != null ? raw.operatingIncome * 1000 : null;
  const netIncomeActual = raw.netIncome != null ? raw.netIncome * 1000 : null;

  if (operatingIncomeActual == null || netIncomeActual == null) {
    throw new AdapterError(`SimFin ${ticker} income: operatingIncome/netIncome missing`);
  }

  const revenueCheck = checkRevenue(revenueActual, { ticker });
  if (!revenueCheck.ok || revenueCheck.value == null) {
    throw new AdapterError(`SimFin ${ticker} income: ${revenueCheck.reason ?? "invalid revenue"}`);
  }

  const effectiveTaxRate = checkTaxRate(null);

  return {
    ticker,
    periodEnd: raw.reportDate,
    fiscalYear: raw.fiscalYear,
    fiscalQuarter: simfinPeriodToQuarter(raw.fiscalPeriod),
    periodType: raw.fiscalPeriod.toUpperCase().includes("Q") ? "Q" : "A",
    currency: raw.currency ?? "USD",

    revenue: revenueCheck.value,
    costOfRevenue: costOfRevenueActual,
    grossProfit: grossProfitActual,

    researchDevelopment: null,
    sellingGeneralAdmin: null,
    depreciationAmortization: null,

    ebit: operatingIncomeActual,
    ebitda: null,

    interestExpense: null,
    interestIncome: null,
    otherNonOperating: null,

    incomeBeforeTax: null,
    incomeTaxExpense: null,
    effectiveTaxRate,
    netIncome: netIncomeActual,
    netIncomeCommon: null,

    epsDiluted: raw.epsDiluted ?? null,
    epsBasic: null,
    sharesDiluted: raw.sharesDiluted ?? null,
    sharesBasic: null,
    dividendsPerShare: null,
    stockBasedCompensation: null,

    meta: defaultProvenance("simfin", fetchedAt, {
      imputed: ["effectiveTaxRate"],
      warnings: ["SimFin adapter scales monetary fields by 1000 (thousands -> actuals)"]
    })
  };
}
