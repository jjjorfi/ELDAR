export interface AlpacaSnapshotRaw {
  symbol: string;
  latestTrade?: { p?: number; t?: string; s?: number } | null;
  latestQuote?: { ap?: number; bp?: number } | null;
  minuteBar?: { o?: number; h?: number; l?: number; c?: number; v?: number } | null;
  dailyBar?: { o?: number; h?: number; l?: number; c?: number; v?: number; t?: string } | null;
  prevDailyBar?: { o?: number; h?: number; l?: number; c?: number; v?: number; t?: string } | null;
}

export interface TwelveDataQuoteRaw {
  symbol: string;
  name?: string;
  exchange?: string;
  close: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  previous_close: string;
  change?: string;
  percent_change?: string;
  datetime?: string;
  timestamp?: number;
  is_market_open?: boolean;
}

export interface FinnhubQuoteRaw {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

export interface TradierQuoteRaw {
  symbol: string;
  description?: string;
  exch?: string;
  last: number;
  change: number;
  change_percentage: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number | null;
  prevclose: number;
  volume?: number;
  average_volume?: number;
  trade_date?: number;
}

export interface YahooChartBarRaw {
  date: string | number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  adjClose?: number | null;
  volume?: number | null;
}

export interface EdgarParsedIncome {
  ticker: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodType: "Q" | "A";
  revenue: number;
  costOfRevenue: number | null;
  grossProfit: number | null;
  researchDevelopment: number | null;
  sellingGeneralAdmin: number | null;
  depreciationAmortization: number | null;
  ebit: number;
  interestExpense: number | null;
  interestIncome: number | null;
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
}

export interface EdgarParsedBalance {
  ticker: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  periodType: "Q" | "A";
  cash: number;
  shortTermInvestments: number | null;
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
}

export interface EdgarParsedCashFlow {
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
  revenue: number | null;
  netIncome: number | null;
}

export interface FmpIncomeStatementRaw {
  symbol: string;
  date: string;
  calendarYear?: string;
  period: string;
  reportedCurrency?: string;
  revenue?: number | null;
  totalRevenue?: number | null;
  costOfRevenue?: number | null;
  grossProfit?: number | null;
  researchAndDevelopmentExpenses?: number | null;
  generalAndAdministrativeExpenses?: number | null;
  depreciationAndAmortization?: number | null;
  operatingIncome?: number | null;
  ebit?: number | null;
  ebitda?: number | null;
  interestExpense?: number | null;
  interestIncome?: number | null;
  totalOtherIncomeExpensesNet?: number | null;
  incomeBeforeIncomeTaxes?: number | null;
  incomeTaxExpense?: number | null;
  netIncome: number;
  netIncomeAvailableToCommonShareholders?: number | null;
  epsdiluted?: number | null;
  eps?: number | null;
  weightedAverageShsOutDil?: number | null;
  weightedAverageShsOut?: number | null;
}

export interface SimfinIncomeStatementRaw {
  ticker: string;
  reportDate: string;
  fiscalYear: number;
  fiscalPeriod: string;
  currency?: string;
  revenue: number | null;
  costRevenue?: number | null;
  grossProfit?: number | null;
  operatingIncome?: number | null;
  netIncome: number | null;
  epsDiluted?: number | null;
  sharesDiluted?: number | null;
}

export interface FinnhubFundamentalsRaw {
  ticker: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  sharesOutstanding: number | null;
}

export interface FREDSeriesMetaRaw {
  id?: string;
  title?: string;
  observation_start?: string;
  observation_end?: string;
  frequency?: string;
  units?: string;
}

export interface FREDObservationRaw {
  date: string;
  value: string;
}

export interface FREDResponseRaw {
  seriess?: FREDSeriesMetaRaw[];
  observations: FREDObservationRaw[];
}

export interface YahooMacroObservationRaw {
  date: string | number;
  value: number | null;
}
