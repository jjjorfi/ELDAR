import { getHomeDashboardPayload } from "@/lib/home/dashboard-service";
import type { SectorRotationWindow } from "@/lib/home/dashboard-types";
import type { HomeDashboardPayload } from "@/lib/home/dashboard-types";
import { fetchTopSp500Movers } from "@/lib/home/sp500-movers";
import { GICS_SECTOR_ETFS } from "@/lib/market/universe/gics-sectors";
import {
  classifySectorSentiment,
  DEFAULT_SECTOR_WINDOW,
  fetchSectorPerformance
} from "@/lib/market/orchestration/sector-performance";
import { buildFredMacroPayload } from "@/lib/macro/fred-snapshot";

export interface SectorSentimentPayload {
  sectors: Array<{
    etf: string;
    changePercent: number | null;
    sentiment: "bullish" | "neutral" | "bearish";
    asOfMs: number | null;
  }>;
  stale?: boolean;
}

export interface MoversPayload {
  movers: Awaited<ReturnType<typeof fetchTopSp500Movers>>;
}

export async function buildHomeDashboardAggregate(window: SectorRotationWindow): Promise<HomeDashboardPayload> {
  return getHomeDashboardPayload(window);
}

export async function buildSectorSentimentAggregate(): Promise<SectorSentimentPayload> {
  const performanceMap = await fetchSectorPerformance(GICS_SECTOR_ETFS, DEFAULT_SECTOR_WINDOW);
  return {
    sectors: GICS_SECTOR_ETFS.map((etf) => {
      const changePercent = performanceMap.get(etf) ?? null;
      return {
        etf,
        changePercent,
        sentiment: classifySectorSentiment(changePercent),
        asOfMs: Date.now()
      };
    }),
    stale: false
  };
}

export async function buildMoversAggregate(limit = 3): Promise<MoversPayload> {
  const movers = await fetchTopSp500Movers(limit);
  return {
    movers
  };
}

export async function buildMacroFredAggregate() {
  return buildFredMacroPayload();
}
