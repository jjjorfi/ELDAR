import type { RatingLabel } from "@/lib/types";

export type PillarKey =
  | "return"
  | "risk"
  | "drawdown"
  | "diversification"
  | "implementability"
  | "eldarTilt";

export interface PillarResult {
  key: PillarKey;
  label: string;
  score: number;
  peerMedian: number;
  weight: number;
  hasData: boolean;
  metrics: Record<string, number | string | null>;
  flags: string[];
}

export interface HoldingWithScore {
  ticker: string;
  name: string;
  weight: number;
  eldarScore: number | null;
  rating: RatingLabel | null;
  contribution: number;
}

export interface PortfolioRiskSeries {
  portfolio: number[];
  benchmark: number[];
  rollingSharpe: number[];
}

export interface PortfolioRating {
  portfolioId: string;
  asOfDate: string;
  peerGroup: string;
  compositeScore: number;
  stars: 1 | 2 | 3 | 4 | 5;
  rating: RatingLabel;
  pillars: PillarResult[];
  holdings: HoldingWithScore[];
  dataCompleteness: number;
  monthsOfHistory: number;
  disclaimers: string[];
  modelVersion: string;
  confidenceFlags: string[];
  peerPercentile: number;
  riskSeries: PortfolioRiskSeries;
}

export interface PortfolioInputHolding {
  ticker: string;
  name: string;
  weight: number;
  shares: number;
  price: number | null;
  sector: string | null;
  eldarScore: number | null;
  rating: RatingLabel | null;
}

export interface PortfolioEngineInput {
  portfolioId: string;
  asOfDate: string;
  holdings: PortfolioInputHolding[];
  benchmarkPoints: number[];
  monthsOfHistory?: number;
}

export interface PortfolioSnapshotHolding {
  symbol: string;
  shares: number;
}

export interface PersistedPortfolioSnapshot {
  id: string;
  userId: string;
  portfolioId: string;
  asOfDate: string;
  holdings: PortfolioSnapshotHolding[];
  rating: PortfolioRating;
  createdAt: string;
}
