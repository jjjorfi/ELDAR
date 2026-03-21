import { AdapterError, defaultProvenance, toUpperTicker } from "@/lib/normalize/adapters/_utils";
import { checkMargin, checkRevenue, checkTaxRate } from "@/lib/normalize/resolver/sanity-checker";
import type {
  CanonicalBalanceSheet,
  CanonicalCashFlow,
  CanonicalIncomeStatement
} from "@/lib/normalize/types/canonical";
import type {
  EdgarParsedBalance,
  EdgarParsedCashFlow,
  EdgarParsedIncome
} from "@/lib/normalize/types/providers";

/**
 * Normalizes an EDGAR-derived income statement into ELDAR's canonical income
 * shape.
 *
 * @param raw Parsed EDGAR income payload.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical income statement payload.
 */
export function normalizeEdgarIncome(raw: EdgarParsedIncome, fetchedAt: string): CanonicalIncomeStatement {
  const ticker = toUpperTicker(raw.ticker);
  const imputed: string[] = [];
  const warnings: string[] = [];

  const revenueCheck = checkRevenue(raw.revenue, { ticker });
  if (!revenueCheck.ok || revenueCheck.value == null) {
    throw new AdapterError(`EDGAR ${ticker} income: ${revenueCheck.reason ?? "invalid revenue"}`);
  }

  const effectiveTaxRate = checkTaxRate(raw.effectiveTaxRate);
  if (raw.effectiveTaxRate == null || effectiveTaxRate !== raw.effectiveTaxRate) {
    imputed.push("effectiveTaxRate");
  }

  let grossProfit = raw.grossProfit;
  if (grossProfit === null && raw.costOfRevenue !== null) {
    grossProfit = raw.revenue - raw.costOfRevenue;
    imputed.push("grossProfit (computed)");
  }

  const ebitda = raw.depreciationAmortization !== null ? raw.ebit + raw.depreciationAmortization : null;
  if (ebitda === null) {
    warnings.push("D&A not available — EBITDA is null");
  }

  const netMarginCheck = checkMargin(raw.netIncome / raw.revenue, "netMargin");
  if (!netMarginCheck.ok && netMarginCheck.reason) {
    warnings.push(netMarginCheck.reason);
  }

  return {
    ticker,
    periodEnd: raw.periodEnd,
    fiscalYear: raw.fiscalYear,
    fiscalQuarter: raw.fiscalQuarter,
    periodType: raw.periodType,
    currency: "USD",

    revenue: revenueCheck.value,
    costOfRevenue: raw.costOfRevenue,
    grossProfit,

    researchDevelopment: raw.researchDevelopment,
    sellingGeneralAdmin: raw.sellingGeneralAdmin,
    depreciationAmortization: raw.depreciationAmortization,

    ebit: raw.ebit,
    ebitda,

    interestExpense: raw.interestExpense,
    interestIncome: raw.interestIncome,
    otherNonOperating: null,

    incomeBeforeTax: raw.incomeBeforeTax,
    incomeTaxExpense: raw.incomeTaxExpense,
    effectiveTaxRate,
    netIncome: raw.netIncome,
    netIncomeCommon: raw.netIncomeCommon,

    epsDiluted: raw.epsDiluted,
    epsBasic: raw.epsBasic,
    sharesDiluted: raw.sharesDiluted,
    sharesBasic: raw.sharesBasic,
    dividendsPerShare: raw.dividendsPerShare,
    stockBasedCompensation: raw.stockBasedCompensation,

    meta: defaultProvenance("edgar", fetchedAt, { imputed, warnings })
  };
}

/**
 * Normalizes an EDGAR-derived balance sheet into ELDAR's canonical balance
 * shape.
 *
 * @param raw Parsed EDGAR balance-sheet payload.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical balance sheet payload.
 */
export function normalizeEdgarBalance(raw: EdgarParsedBalance, fetchedAt: string): CanonicalBalanceSheet {
  const ticker = toUpperTicker(raw.ticker);
  const imputed: string[] = [];

  const totalDebt =
    (raw.shortTermDebt ?? 0) +
    (raw.currentPortionLTD ?? 0) +
    (raw.longTermDebt ?? 0) +
    (raw.operatingLeaseLiability ?? 0);

  const netDebt = totalDebt - raw.cash;
  const totalCashAndInvestments = raw.shortTermInvestments != null ? raw.cash + raw.shortTermInvestments : null;
  const investedCapital = raw.stockholdersEquity + totalDebt - raw.cash;
  const tangibleBookValue =
    raw.goodwill != null || raw.intangibleAssets != null
      ? raw.stockholdersEquity - (raw.goodwill ?? 0) - (raw.intangibleAssets ?? 0)
      : null;
  const workingCapital =
    raw.totalCurrentAssets != null && raw.totalCurrentLiabilities != null
      ? raw.totalCurrentAssets - raw.totalCurrentLiabilities
      : null;
  const bookValuePerShare =
    raw.sharesOutstanding != null && raw.sharesOutstanding > 0
      ? raw.stockholdersEquity / raw.sharesOutstanding
      : null;

  if (raw.shortTermInvestments == null) {
    imputed.push("totalCashAndInvestments (partial)");
  }

  return {
    ticker,
    periodEnd: raw.periodEnd,
    fiscalYear: raw.fiscalYear,
    fiscalQuarter: raw.fiscalQuarter,
    periodType: raw.periodType,

    cash: raw.cash,
    shortTermInvestments: raw.shortTermInvestments,
    totalCashAndInvestments,
    accountsReceivable: raw.accountsReceivable,
    inventory: raw.inventory,
    otherCurrentAssets: raw.otherCurrentAssets,
    totalCurrentAssets: raw.totalCurrentAssets,

    ppAndENet: raw.ppAndENet,
    ppAndEGross: raw.ppAndEGross,
    goodwill: raw.goodwill,
    intangibleAssets: raw.intangibleAssets,
    otherNonCurrentAssets: raw.otherNonCurrentAssets,
    totalAssets: raw.totalAssets,

    accountsPayable: raw.accountsPayable,
    shortTermDebt: raw.shortTermDebt,
    currentPortionLTD: raw.currentPortionLTD,
    deferredRevenueCurrent: raw.deferredRevenueCurrent,
    otherCurrentLiabilities: raw.otherCurrentLiabilities,
    totalCurrentLiabilities: raw.totalCurrentLiabilities,

    longTermDebt: raw.longTermDebt,
    operatingLeaseLiability: raw.operatingLeaseLiability,
    otherNonCurrentLiabilities: raw.otherNonCurrentLiabilities,
    totalLiabilities: raw.totalLiabilities,

    retainedEarnings: raw.retainedEarnings,
    treasuryStock: raw.treasuryStock,
    stockholdersEquity: raw.stockholdersEquity,
    sharesOutstanding: raw.sharesOutstanding,

    totalDebt,
    netDebt,
    investedCapital,
    tangibleBookValue,
    workingCapital,
    bookValuePerShare,

    meta: defaultProvenance("edgar", fetchedAt, { imputed })
  };
}

/**
 * Normalizes an EDGAR-derived cash-flow statement into ELDAR's canonical cash
 * flow shape.
 *
 * @param raw Parsed EDGAR cash-flow payload.
 * @param fetchedAt ISO fetch timestamp supplied by the caller.
 * @returns Canonical cash-flow payload.
 */
export function normalizeEdgarCashFlow(raw: EdgarParsedCashFlow, fetchedAt: string): CanonicalCashFlow {
  const ticker = toUpperTicker(raw.ticker);
  const imputed: string[] = [];
  const warnings: string[] = [];

  const freeCashFlow = raw.capex != null ? raw.operatingCashFlow - Math.abs(raw.capex) : null;
  if (raw.capex == null) {
    warnings.push("CapEx unavailable — freeCashFlow is null");
  }

  const fcfMargin = freeCashFlow != null && raw.revenue != null && raw.revenue > 0 ? freeCashFlow / raw.revenue : null;
  const fcfConversion =
    freeCashFlow != null && raw.netIncome != null && raw.netIncome !== 0 ? freeCashFlow / raw.netIncome : null;

  if (fcfMargin == null && raw.revenue == null) {
    imputed.push("fcfMargin (missing revenue)");
  }

  return {
    ticker,
    periodEnd: raw.periodEnd,
    fiscalYear: raw.fiscalYear,
    fiscalQuarter: raw.fiscalQuarter,
    periodType: raw.periodType,

    operatingCashFlow: raw.operatingCashFlow,
    depreciationAmortization: raw.depreciationAmortization,
    stockBasedCompensation: raw.stockBasedCompensation,
    changesInWorkingCapital: raw.changesInWorkingCapital,

    capex: raw.capex,
    acquisitions: raw.acquisitions,
    purchasesOfInvestments: raw.purchasesOfInvestments,
    salesOfInvestments: raw.salesOfInvestments,
    investingCashFlow: raw.investingCashFlow,

    debtIssuance: raw.debtIssuance,
    debtRepayment: raw.debtRepayment,
    shareIssuance: raw.shareIssuance,
    shareBuybacks: raw.shareBuybacks,
    dividendsPaid: raw.dividendsPaid,
    financingCashFlow: raw.financingCashFlow,

    freeCashFlow,
    fcfMargin,
    fcfConversion,

    meta: defaultProvenance("edgar", fetchedAt, { imputed, warnings })
  };
}
