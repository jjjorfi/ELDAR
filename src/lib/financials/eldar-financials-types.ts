// Canonical financials type surfaces shared across pipeline and adapters.

export type PriceSource = "ALPACA" | "TWELVEDATA" | "MARKETSTACK" | "ALPHA_VANTAGE" | "YAHOO_FALLBACK";

export interface CompanyProfile {
  ticker: string;
  cik: string;
  name: string;
  exchange: string;
  sector: string;
  sic: string;
  currency: string;
  fiscalYearEnd: string;
  description: string;
  employees: number | null;
}

export interface QuarterlyIncome {
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  formType: "10-Q" | "10-K";
  filedDate: string;
  revenue: number;
  costOfRevenue: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  researchDevelopment: number | null;
  sellingGeneralAdmin: number | null;
  depreciationAmortization: number | null;
  stockBasedCompensation: number | null;
  ebit: number;
  ebitda: number | null;
  ebitMargin: number | null;
  ebitdaMargin: number | null;
  interestExpense: number | null;
  interestIncome: number | null;
  netInterestExpense: number | null;
  incomeBeforeTax: number | null;
  incomeTaxExpense: number | null;
  effectiveTaxRate: number | null;
  netIncome: number;
  netMargin: number | null;
  epsDiluted: number | null;
  epsBasic: number | null;
  sharesDiluted: number | null;
  sharesBasic: number | null;
  dividendsPerShare: number | null;
}

export interface QuarterlyBalanceSheet {
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  cash: number;
  shortTermInvestments: number | null;
  totalCashAndInvestments: number | null;
  accountsReceivable: number | null;
  inventory: number | null;
  totalCurrentAssets: number | null;
  ppAndENet: number | null;
  ppAndEGross: number | null;
  goodwill: number | null;
  intangibleAssets: number | null;
  totalAssets: number;
  accountsPayable: number | null;
  shortTermDebt: number | null;
  currentPortionLTD: number | null;
  deferredRevenueCurrent: number | null;
  totalCurrentLiabilities: number | null;
  longTermDebt: number | null;
  operatingLeaseLiability: number | null;
  totalLiabilities: number | null;
  retainedEarnings: number | null;
  treasuryStock: number | null;
  stockholdersEquity: number;
  sharesOutstanding: number | null;
  totalDebt: number | null;
  netDebt: number | null;
  investedCapital: number | null;
  tangibleBookValue: number | null;
  bookValuePerShare: number | null;
  tangibleBookValuePerShare: number | null;
  workingCapital: number | null;
}

export interface QuarterlyCashFlow {
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  operatingCashFlow: number;
  depreciationAmortization: number | null;
  stockBasedCompensation: number | null;
  capex: number | null;
  acquisitions: number | null;
  purchasesOfInvestments: number | null;
  salesOfInvestments: number | null;
  investingCashFlow: number | null;
  debtIssuance: number | null;
  debtRepayment: number | null;
  shareIssuance: number | null;
  shareBuybacks: number | null;
  dividendsPaid: number | null;
  financingCashFlow: number | null;
  freeCashFlow: number | null;
  fcfMargin: number | null;
  fcfConversion: number | null;
}

export interface QuarterlyRatios {
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodEnd: string;
  priceAtPeriodEnd: number | null;
  marketCapAtPeriodEnd: number | null;
  enterpriseValue: number | null;
  evToEbitda: number | null;
  evToEbit: number | null;
  evToRevenue: number | null;
  evToFCF: number | null;
  peRatio: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  priceToFCF: number | null;
  fcfYield: number | null;
  grossMargin: number | null;
  ebitMargin: number | null;
  ebitdaMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  roic: number | null;
  roe: number | null;
  roa: number | null;
  roce: number | null;
  croic: number | null;
  netDebtToEbitda: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  cashRatio: number | null;
  assetTurnover: number | null;
  inventoryTurnover: number | null;
  receivablesTurnover: number | null;
  daysSalesOutstanding: number | null;
  daysInventoryOutstanding: number | null;
  daysPayableOutstanding: number | null;
  cashConversionCycle: number | null;
  accrualsRatio: number | null;
  fcfConversion: number | null;
  sbcToRevenue: number | null;
}

export interface TTMMetrics {
  revenue: number;
  grossProfit: number | null;
  ebit: number;
  ebitda: number | null;
  netIncome: number;
  operatingCashFlow: number;
  freeCashFlow: number | null;
  capex: number | null;
  dividendsPaid: number | null;
  shareBuybacks: number | null;
  grossMargin: number | null;
  ebitMargin: number | null;
  ebitdaMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  epsDiluted: number | null;
  fcfPerShare: number | null;
  revenuePerShare: number | null;
}

export interface GrowthMetrics {
  revenueGrowthYoY: number | null;
  revenueGrowthQoQ: number | null;
  revenueCagr3Y: number | null;
  grossProfitGrowthYoY: number | null;
  ebitGrowthYoY: number | null;
  ebitdaGrowthYoY: number | null;
  netIncomeGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  fcfGrowthYoY: number | null;
  epsCagr3Y: number | null;
  revenueCagr5Y: number | null;
  revenueAcceleration: number | null;
  epsAcceleration: number | null;
  grossMarginExpansionYoY: number | null;
  ebitMarginExpansionYoY: number | null;
  netMarginExpansionYoY: number | null;
}

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

export interface PriceHistory {
  daily: PricePoint[];
  beta1Y: number | null;
  high52W: number | null;
  low52W: number | null;
  avgVolume30D: number | null;
  avgVolume90D: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  priceVsMa200Pct: number | null;
  volumeRatio: number | null;
  momentum12_2: number | null;
}

export interface FinancialsQuality {
  fundamentalsSource: "SEC_EDGAR";
  pricesSource: PriceSource;
  latestFieldSourceTrace: Record<string, string>;
  restatedPeriods: string[];
  stats: {
    quartersParsed: number;
    quartersAligned: number;
    imputedFieldCount: number;
    warningCount: number;
  };
}

export interface CompanyFinancials {
  ticker: string;
  cik: string;
  asOf: string;
  pipelineVersion: string;
  profile: CompanyProfile;
  income: QuarterlyIncome[];
  balance: QuarterlyBalanceSheet[];
  cashflow: QuarterlyCashFlow[];
  ratios: QuarterlyRatios[];
  ttm: TTMMetrics;
  growth: GrowthMetrics;
  prices: PriceHistory;
  quality: FinancialsQuality;
  confidence: "high" | "medium" | "low";
  imputedFields: string[];
  warnings: string[];
}
