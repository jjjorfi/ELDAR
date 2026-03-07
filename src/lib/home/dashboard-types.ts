// AI CONTEXT TRACE
// Shared home dashboard types for the dashboard API, StockDashboard UI, and
// home dashboard modules. Keeping these centralized prevents route/UI drift
// and lets us refactor dashboard rendering without changing the payload shape.

import type { SectorPerformanceWindow } from "@/lib/market/sector-performance";

export type SectorRotationWindow = SectorPerformanceWindow;

export interface HomeRegimeMetric {
  key: "tenYearYield" | "vix" | "dxy" | "oil";
  label: string;
  value: number | null;
  changePercent: number | null;
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

export interface HomeDashboardPayload {
  generatedAt: string;
  sectorWindow: SectorRotationWindow;
  regime: {
    label: "RISK_ON" | "BALANCED" | "RISK_OFF";
    summary: string;
    metrics: HomeRegimeMetric[];
  };
  snapshot: HomeSnapshotItem[];
  marketMovers: HomeMarketMoverItem[];
  sectorRotation: HomeSectorRotationItem[];
}
