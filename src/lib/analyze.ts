import { fetchMarketSnapshot } from "@/lib/market/yahoo";
import { scoreSnapshot } from "@/lib/scoring/engine";
import type { AnalysisResult } from "@/lib/types";

export async function analyzeStock(symbol: string): Promise<AnalysisResult> {
  const snapshot = await fetchMarketSnapshot(symbol);
  return scoreSnapshot(snapshot);
}
