import { getEarningsPayload, type EarningsPayload } from "@/lib/features/earnings/service";
import { buildPriceHistoryPayload } from "@/lib/features/price/history-service";
import type { PriceRange } from "@/lib/features/price/types";
import { getHomeDashboardPayload } from "@/lib/home/dashboard-service";
import { buildIndicesYtdAggregate } from "@/lib/home/indices-ytd";
import type { SectorRotationWindow } from "@/lib/home/dashboard-types";
import type { HomeDashboardPayload } from "@/lib/home/dashboard-types";
import { fetchTopSp500Movers } from "@/lib/home/sp500-movers";
import { buildMag7AggregatePayload, type Mag7SnapshotPayload } from "@/lib/mag7";
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

export interface EarningsAggregatePayload extends EarningsPayload {}

export async function buildIndicesYtdSnapshotAggregate() {
  return buildIndicesYtdAggregate();
}

export async function buildMag7SnapshotAggregate(mode: "live" | "home"): Promise<Mag7SnapshotPayload> {
  return buildMag7AggregatePayload(mode);
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

export async function buildEarningsAggregate(): Promise<EarningsAggregatePayload> {
  const result = await getEarningsPayload();
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.payload;
}

export async function buildPriceHistoryAggregate(symbol: string, range: PriceRange) {
  return buildPriceHistoryPayload(symbol, range);
}
