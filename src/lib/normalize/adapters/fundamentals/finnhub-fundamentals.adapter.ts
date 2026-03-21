import { AdapterError, defaultProvenance, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkRevenue, checkTaxRate } from "@/lib/normalize/resolver/sanity-checker";
import type { CanonicalIncomeStatement } from "@/lib/normalize/types/canonical";
import type { FinnhubFundamentalsRaw } from "@/lib/normalize/types/providers";

/**
 * Normalizes Finnhub's sparse fundamentals income payload into ELDAR's
 * canonical income shape.
 *
 * @param raw Raw Finnhub fundamentals payload.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical income statement payload.
 */
export function normalizeFinnhubFundamentalsIncome(
  raw: FinnhubFundamentalsRaw,
  fetchedAt: string
): CanonicalIncomeStatement {
  const ticker = toUpperTicker(raw.ticker);

  if (raw.revenue == null || raw.netIncome == null) {
    throw new AdapterError(`Finnhub fundamentals ${ticker}: revenue/netIncome missing`);
  }

  const revenueCheck = checkRevenue(raw.revenue, { ticker });
  if (!revenueCheck.ok || revenueCheck.value == null) {
    throw new AdapterError(`Finnhub fundamentals ${ticker}: ${revenueCheck.reason ?? "invalid revenue"}`);
  }

  return {
    ticker,
    periodEnd: raw.periodEnd,
    fiscalYear: raw.fiscalYear,
    fiscalQuarter: raw.fiscalQuarter,
    periodType: "Q",
    currency: "USD",

    revenue: revenueCheck.value,
    costOfRevenue: null,
    grossProfit: null,

    researchDevelopment: null,
    sellingGeneralAdmin: null,
    depreciationAmortization: null,

    ebit: raw.netIncome,
    ebitda: null,

    interestExpense: null,
    interestIncome: null,
    otherNonOperating: null,

    incomeBeforeTax: null,
    incomeTaxExpense: null,
    effectiveTaxRate: checkTaxRate(null),
    netIncome: raw.netIncome,
    netIncomeCommon: raw.netIncome,

    epsDiluted: raw.eps,
    epsBasic: raw.eps,
    sharesDiluted: raw.sharesOutstanding,
    sharesBasic: raw.sharesOutstanding,
    dividendsPerShare: null,
    stockBasedCompensation: null,

    meta: defaultProvenance("finnhub_fundamentals", fetchedAt, {
      imputed: ["effectiveTaxRate"],
      warnings: ["Finnhub fundamentals adapter is supplemental and sparse"]
    })
  };
}
