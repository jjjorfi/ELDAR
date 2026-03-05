import type { RatingLabel } from "@/lib/types";

export interface SignalCardProps {
  ticker: string;
  companyName: string;
  sector: string;
  score: number;
  rating: RatingLabel;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  drivers: string[];
  risks: string[];
  sectorRank?: number;
  scoreChange?: number;
}

export interface ComparisonStock {
  ticker: string;
  name: string;
  score: number;
  rating: RatingLabel;
  factors: [number, number, number, number];
}

export interface PortfolioXRayCardProps {
  portfolioName: string;
  compositeScore: number;
  stars: 1 | 2 | 3 | 4 | 5;
  rating: RatingLabel;
  peerGroup: string;
  strongBuyPct: number;
  strongSellPct: number;
  topHoldings: {
    ticker: string;
    weight: number;
    score: number;
    rating: RatingLabel;
  }[];
}
