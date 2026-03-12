export type DataSource =
  | "alpaca"
  | "twelve_data"
  | "finnhub"
  | "tradier"
  | "yahoo"
  | "stooq"
  | "edgar"
  | "fmp"
  | "simfin"
  | "finnhub_fundamentals"
  | "fred"
  | "yahoo_macro"
  | "cache"
  | "computed";

export interface DataProvenance {
  source: DataSource;
  fetchedAt: string;
  delayMins: number;
  stale: boolean;
  staleMins: number;
  conflicted: boolean;
  imputed: string[];
  warnings: string[];
}

export type ChartInterval = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "2Y" | "5Y" | "10Y" | "MAX";

export interface CanonicalQuote {
  ticker: string;
  exchange: string | null;

  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number;
  change: number;
  changePct: number;
  volume: number | null;
  avgVolume: number | null;

  marketCap: number | null;
  sharesOut: number | null;

  marketState: "pre" | "regular" | "post" | "closed" | "unknown";
  timestamp: string;

  meta: DataProvenance;
}

export interface CanonicalPriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

export interface CanonicalChartHistory {
  ticker: string;
  interval: ChartInterval;
  bars: CanonicalPriceBar[];
  meta: DataProvenance;
}

export interface CanonicalIncomeStatement {
  ticker: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodType: "Q" | "A";
  currency: string;

  revenue: number;
  costOfRevenue: number | null;
  grossProfit: number | null;

  researchDevelopment: number | null;
  sellingGeneralAdmin: number | null;
  depreciationAmortization: number | null;

  ebit: number;
  ebitda: number | null;

  interestExpense: number | null;
  interestIncome: number | null;
  otherNonOperating: number | null;

  incomeBeforeTax: number | null;
  incomeTaxExpense: number | null;
  effectiveTaxRate: number | null;
  netIncome: number;
  netIncomeCommon: number | null;

  epsDiluted: number | null;
  epsBasic: number | null;
  sharesDiluted: number | null;
  sharesBasic: number | null;
  dividendsPerShare: number | null;
  stockBasedCompensation: number | null;

  meta: DataProvenance;
}

export interface CanonicalBalanceSheet {
  ticker: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodType: "Q" | "A";

  cash: number;
  shortTermInvestments: number | null;
  totalCashAndInvestments: number | null;
  accountsReceivable: number | null;
  inventory: number | null;
  otherCurrentAssets: number | null;
  totalCurrentAssets: number | null;

  ppAndENet: number | null;
  ppAndEGross: number | null;
  goodwill: number | null;
  intangibleAssets: number | null;
  otherNonCurrentAssets: number | null;
  totalAssets: number;

  accountsPayable: number | null;
  shortTermDebt: number | null;
  currentPortionLTD: number | null;
  deferredRevenueCurrent: number | null;
  otherCurrentLiabilities: number | null;
  totalCurrentLiabilities: number | null;

  longTermDebt: number | null;
  operatingLeaseLiability: number | null;
  otherNonCurrentLiabilities: number | null;
  totalLiabilities: number | null;

  retainedEarnings: number | null;
  treasuryStock: number | null;
  stockholdersEquity: number;
  sharesOutstanding: number | null;

  totalDebt: number | null;
  netDebt: number | null;
  investedCapital: number | null;
  tangibleBookValue: number | null;
  workingCapital: number | null;
  bookValuePerShare: number | null;

  meta: DataProvenance;
}

export interface CanonicalCashFlow {
  ticker: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodType: "Q" | "A";

  operatingCashFlow: number;
  depreciationAmortization: number | null;
  stockBasedCompensation: number | null;
  changesInWorkingCapital: number | null;

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

  meta: DataProvenance;
}

export interface CanonicalObservation {
  date: string;
  value: number;
  revised: boolean;
}

export type MacroUnit = "percent" | "percent_annual" | "bps" | "usd" | "index" | "ratio";

export type MacroFrequency = "daily" | "weekly" | "monthly" | "quarterly";

export interface CanonicalMacroSeries {
  seriesId: string;
  name: string;
  unit: MacroUnit;
  frequency: MacroFrequency;
  observations: CanonicalObservation[];
  latest: CanonicalObservation;
  meta: DataProvenance;
}
