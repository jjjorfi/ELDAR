// AI CONTEXT TRACE
// Shared home dashboard types for the dashboard API, StockDashboard UI, and
// home dashboard modules. Keeping these centralized prevents route/UI drift
// and lets us refactor dashboard rendering without changing the payload shape.

import type { SectorPerformanceWindow } from "@/lib/market/sector-performance";
import type {
  GateFired,
  MacroInputV2,
  MacroRegimeV2,
  MacroScoreV2
} from "@/lib/scoring/eldar-macro-v2";

export type SectorRotationWindow = SectorPerformanceWindow;

export interface HomeRegimeMetric {
  key: "vix" | "dxy" | "oilWTI" | "nominal10Y";
  label: string;
  value: number | null;
  displayValue: string;
  detail: string;
  tone: "positive" | "neutral" | "negative";
}

export interface HomeSnapshotItem {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
}

export interface HomeMarketMoverItem {
  symbol: string;
  companyName: string;
  currentPrice: number | null;
  changePercent: number;
}

export interface HomeSectorRotationItem {
  etf: string;
  name: string;
  performancePercent: number | null;
  signalScore: number | null;
  signalStrength: "STRONG" | "CONSTRUCTIVE" | "NEUTRAL" | "WEAK" | "UNAVAILABLE";
}

export interface HomeNewsItem {
  symbol: string | null;
  headline: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
}

export interface HomeDashboardPayload {
  generatedAt: string;
  sectorWindow: SectorRotationWindow;
  regime: {
    label: MacroRegimeV2;
    summary: string;
    compositeScore: number;
    formulaScore: number;
    modelVersion: string;
    confidence: MacroScoreV2["confidence"];
    warnings: string[];
    gatesFired: GateFired[];
    pillars: MacroScoreV2["pillars"];
    inputSnapshot: MacroInputV2;
    metrics: HomeRegimeMetric[];
  };
  snapshot: HomeSnapshotItem[];
  marketMovers: HomeMarketMoverItem[];
  sectorRotation: HomeSectorRotationItem[];
  marketNews: HomeNewsItem[];
}
