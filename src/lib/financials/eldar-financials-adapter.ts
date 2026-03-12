// File Purpose:
// - Adapts canonical CompanyFinancials output to engine-facing inputs.
// - Keeps pipeline independent from scoring model interfaces.

import type { CompanyFinancials } from "@/lib/financials/eldar-financials-pipeline";
import { PipelineExcludedError } from "@/lib/financials/eldar-financials-pipeline";
import type { MarketSnapshot } from "@/lib/types";

export interface V81QuarterlyInput {
  quarter: string;
  periodEnd: string;
  revenue: number;
  ebitda: number | null;
  ebit: number;
  netIncome: number;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  totalAssets: number | null;
  totalDebt: number | null;
  cash: number | null;
  investedCapital: number | null;
  stockholdersEquity: number | null;
  sharesOutstanding: number | null;
  eps: number | null;
  taxRate: number;
  capex: number | null;
  sbc: number | null;
  depreciationAmortization: number | null;
}

export interface V81PriceInput {
  date: string;
  close: number;
  volume: number;
}

export interface V81StockInput {
  ticker: string;
  sector: string;
  asOfDate: string;
  financials: V81QuarterlyInput[];
  prices: V81PriceInput[];
  market: {
    currentPrice: number;
    marketCap: number | null;
    enterpriseValue: number | null;
  };
  estimates: Array<unknown>;
  priorScore?: number;
  priorRating?: string;
}

const ENGINE_EXCLUDED_SECTORS = new Set(["Financials", "Real Estate"]);

export function toV81StockInput(financials: CompanyFinancials): V81StockInput {
  if (ENGINE_EXCLUDED_SECTORS.has(financials.profile.sector)) {
    throw new PipelineExcludedError(
      financials.ticker,
      financials.profile.sector,
      `Ticker ${financials.ticker} belongs to ${financials.profile.sector}; V8.1 does not score this sector.`
    );
  }

  const latestRatio = financials.ratios.at(-1);
  const latestPrice = financials.prices.daily.at(-1)?.adjClose ?? 0;

  return {
    ticker: financials.ticker,
    sector: financials.profile.sector,
    asOfDate: financials.asOf,
    financials: financials.income.map((incomeRow, index) => {
      const balanceRow = financials.balance[index];
      const cashflowRow = financials.cashflow[index];
      return {
        quarter: `${incomeRow.fiscalYear}-Q${incomeRow.fiscalQuarter}`,
        periodEnd: incomeRow.periodEnd,
        revenue: incomeRow.revenue,
        ebitda: incomeRow.ebitda,
        ebit: incomeRow.ebit,
        netIncome: incomeRow.netIncome,
        operatingCashFlow: cashflowRow?.operatingCashFlow ?? null,
        freeCashFlow: cashflowRow?.freeCashFlow ?? null,
        totalAssets: balanceRow?.totalAssets ?? null,
        totalDebt: balanceRow?.totalDebt ?? null,
        cash: balanceRow?.cash ?? null,
        investedCapital: balanceRow?.investedCapital ?? null,
        stockholdersEquity: balanceRow?.stockholdersEquity ?? null,
        sharesOutstanding: incomeRow.sharesDiluted ?? balanceRow?.sharesOutstanding ?? null,
        eps: incomeRow.epsDiluted ?? null,
        taxRate: incomeRow.effectiveTaxRate ?? 0.21,
        capex: cashflowRow?.capex ?? null,
        sbc: incomeRow.stockBasedCompensation ?? null,
        depreciationAmortization: cashflowRow?.depreciationAmortization ?? null
      };
    }),
    prices: financials.prices.daily.slice(-273).map((point) => ({
      date: point.date,
      close: point.adjClose,
      volume: point.volume
    })),
    market: {
      currentPrice: latestPrice,
      marketCap: latestRatio?.marketCapAtPeriodEnd ?? null,
      enterpriseValue: latestRatio?.enterpriseValue ?? null
    },
    estimates: []
  };
}

export function toMarketSnapshot(financials: CompanyFinancials): MarketSnapshot {
  const latestIncome = financials.income.at(-1);
  const latestBalance = financials.balance.at(-1);
  const latestRatio = financials.ratios.at(-1);
  const latestPrice = financials.prices.daily.at(-1)?.adjClose ?? 0;

  return {
    symbol: financials.ticker,
    companyName: financials.profile.name,
    sector: financials.profile.sector,
    currency: "USD",
    currentPrice: latestPrice,
    marketCap: latestRatio?.marketCapAtPeriodEnd ?? null,
    earningsQuarterlyGrowth: financials.growth.epsGrowthYoY,
    forwardEps: null,
    trailingEps: financials.ttm.epsDiluted,
    revenueGrowth: financials.growth.revenueGrowthYoY,
    fcfYield: latestRatio?.fcfYield ?? null,
    debtToEquity: latestRatio?.debtToEquity ?? null,
    forwardPE: null,
    forwardPEBasis: null,
    roic: latestRatio?.roic ?? null,
    roicTrend: financials.growth.ebitMarginExpansionYoY,
    ffoYield: null,
    evEbitda: latestRatio?.evToEbitda ?? null,
    epsRevision30d: null,
    earningsGrowthBasis: financials.growth.epsGrowthYoY !== null ? "YOY" : null,
    technical: {
      sma200: financials.prices.ma200,
      rs52Week: null,
      zScore52Week: null,
      priceZScore20d: null,
      rsi14: financials.prices.rsi14,
      dtc: null
    },
    options: {
      putCallRatio: null,
      totalCallVolume: null,
      totalPutVolume: null
    },
    insider: {
      netBuyRatio90d: null
    },
    shortPercentOfFloat: null,
    macro: {
      vixLevel: null,
      commodityMomentum12m: null
    }
  };
}

export function toFundamentalsBar(financials: CompanyFinancials): {
  pe: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
  fcfYield: number | null;
} {
  const latestRatio = financials.ratios.at(-1);
  return {
    pe: latestRatio?.peRatio ?? null,
    revenueGrowth: financials.growth.revenueGrowthYoY,
    epsGrowth: financials.growth.epsGrowthYoY,
    fcfYield: latestRatio?.fcfYield ?? null
  };
}
