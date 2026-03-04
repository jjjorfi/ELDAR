import type { PortfolioRating } from "@/lib/scoring/portfolio-types";

import { CompositeScoreBreakdown } from "@/components/portfolio/CompositeScoreBreakdown";
import { HoldingsAlphaTable } from "@/components/portfolio/HoldingsAlphaTable";
import { MethodologyDisclosure } from "@/components/portfolio/MethodologyDisclosure";
import { PillarScoreGrid } from "@/components/portfolio/PillarScoreGrid";
import { PortfolioRatingHeader } from "@/components/portfolio/PortfolioRatingHeader";
import { RiskCharts } from "@/components/portfolio/RiskCharts";

export function PortfolioRatingPanel({ rating }: { rating: PortfolioRating }): JSX.Element {
  return (
    <div className="space-y-4">
      <PortfolioRatingHeader rating={rating} />
      <PillarScoreGrid pillars={rating.pillars} />
      <CompositeScoreBreakdown rating={rating} />
      <HoldingsAlphaTable rating={rating} />
      <RiskCharts rating={rating} />
      <MethodologyDisclosure />
    </div>
  );
}

