export type RatingLabel = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";

export type FactorSignal = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface FactorResult {
  category:
    | "Options"
    | "Macro"
    | "Fundamental"
    | "Sentiment"
    | "Seasonality"
    | "Technical"
    | "Valuation"
    | "Momentum";
  factor: string;
  bullishPoints: number;
  bearishPoints: number;
  points: number;
  weight: number;
  signal: FactorSignal;
  ruleMatched: string;
  metricValue: string;
}

export interface MacroSignals {
  fedSignal: "DOVISH" | "HAWKISH" | "UNCHANGED" | "UNKNOWN";
  fedDelta: number | null;
  fedCutProbability: number | null;
  fedHoldProbability: number | null;
  fedHikeProbability: number | null;
  fedNextMeetingDate: string | null;
  fedOddsSource: string | null;
  vixLevel: number | null;
  marketPutCallRatio: number | null;
  gdpSurprise: number | null;
}

export interface SeasonalityData {
  positiveMonthRatio10y: number | null;
  sampleSize: number;
}

export interface TechnicalData {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
}

export interface SentimentData {
  upgrades90d: number;
  downgrades90d: number;
  articleCount: number;
}

export interface OptionsData {
  putCallRatio: number | null;
  totalCallVolume: number | null;
  totalPutVolume: number | null;
  source: string | null;
}

export interface MarketSnapshot {
  symbol: string;
  companyName: string;
  sector: string;
  currency: string;
  currentPrice: number;
  marketCap: number | null;
  earningsQuarterlyGrowth: number | null;
  forwardEps: number | null;
  trailingEps: number | null;
  epsEstimate: number | null;
  forwardPE: number | null;
  returnOnEquity: number | null;
  debtToEquity: number | null;
  grossMargins: number | null;
  grossMarginsTTM: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  shortPercentOfFloat: number | null;
  freeCashflow: number | null;
  fcfYield: number | null;
  macro: MacroSignals;
  seasonality: SeasonalityData;
  technical: TechnicalData;
  sentiment: SentimentData;
  options: OptionsData;
}

export interface AnalysisResult {
  modelVersion: string;
  symbol: string;
  companyName: string;
  sector: string;
  currency: string;
  currentPrice: number;
  marketCap: number | null;
  score: number;
  rating: RatingLabel;
  ratingNote: string;
  factors: FactorResult[];
  generatedAt: string;
}

export interface PersistedAnalysis extends AnalysisResult {
  id: string;
  createdAt: string;
}

export interface WatchlistItem {
  symbol: string;
  createdAt: string;
  latest?: PersistedAnalysis;
}

export interface Mag7ScoreCard {
  symbol: string;
  companyName: string;
  score: number;
  rating: RatingLabel;
  currentPrice: number;
  changePercent: number | null;
  updatedAt: string;
}
