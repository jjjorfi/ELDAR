"use client";

import type { PortfolioRating } from "@/lib/scoring/portfolio/types";

import { HoldingsAlphaTable } from "@/components/portfolio/HoldingsAlphaTable";
import { PillarScoreGrid } from "@/components/portfolio/PillarScoreGrid";
import { PortfolioRatingHeader } from "@/components/portfolio/PortfolioRatingHeader";
import { EvidenceAccordions } from "@/components/ui/AnalysisPrimitives";

export function PortfolioRatingPanel({ rating }: { rating: PortfolioRating }): JSX.Element {
  const methodologyText =
    "Portfolio rating is based on trailing historical performance and current holdings composition. " +
    "Ratings are peer-relative within the classified peer group and gated when data coverage is low.";

  return (
    <div className="space-y-3">
      <PortfolioRatingHeader rating={rating} />
      <PillarScoreGrid pillars={rating.pillars} />
      <HoldingsAlphaTable rating={rating} />
      <EvidenceAccordions
        sections={[
          {
            id: "portfolio-methodology",
            label: "Evidence · Methodology",
            content: <p className="text-sm text-white/75">{methodologyText}</p>
          }
        ]}
      />
    </div>
  );
}
