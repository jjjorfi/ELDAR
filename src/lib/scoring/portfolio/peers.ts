import type { PortfolioInputHolding } from "@/lib/scoring/portfolio/types";

function normalizeSectorName(value: string | null): string {
  if (!value) return "Other";
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : "Other";
}

export function classifyPeerGroup(holdings: PortfolioInputHolding[]): string {
  if (holdings.length === 0) {
    return "US Equity";
  }

  const sectorWeights = new Map<string, number>();
  let totalWeight = 0;

  for (const holding of holdings) {
    const weight = Math.max(0, holding.weight);
    totalWeight += weight;
    const sector = normalizeSectorName(holding.sector);
    sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + weight);
  }

  if (totalWeight <= 0) {
    return "US Equity";
  }

  let topSector = "Other";
  let topSectorWeight = 0;
  for (const [sector, weight] of sectorWeights.entries()) {
    if (weight > topSectorWeight) {
      topSectorWeight = weight;
      topSector = sector;
    }
  }

  const topSectorRatio = topSectorWeight / totalWeight;
  if (topSectorRatio > 0.6) {
    return `Sector: ${topSector}`;
  }

  return "US Equity";
}

