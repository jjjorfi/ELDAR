import clsx from "clsx";

import { RATING_BANDS } from "@/lib/rating";
import type { PortfolioRating } from "@/lib/scoring/portfolio-types";

export function CompositeScoreBreakdown({ rating }: { rating: PortfolioRating }): JSX.Element {
  const available = rating.pillars.filter((pillar) => pillar.hasData);
  const totalWeight = available.reduce((sum, pillar) => sum + pillar.weight, 0);
  const contributions = available.map((pillar) => {
    const weighted = totalWeight > 0 ? ((pillar.score / 100) * pillar.weight * 10) / totalWeight : 0;
    return {
      key: pillar.key,
      label: pillar.label,
      contribution: weighted
    };
  });

  return (
    <section className="eldar-panel rounded-2xl p-4">
      <h3 className="text-[10px] uppercase tracking-[0.12em] text-white/55">Composite Score Breakdown</h3>
      <div className="mt-3 space-y-2">
        {contributions.map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-white/75">{row.label}</span>
              <span className="font-mono text-white">{row.contribution.toFixed(2)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-zinc-200/80" style={{ width: `${Math.max(2, Math.min(100, (row.contribution / 2) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-white/15 pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Total</p>
          <p className="font-mono text-lg font-bold text-white">{rating.compositeScore.toFixed(2)} / 10</p>
        </div>
        <p
          className={clsx("mt-1 text-sm font-semibold")}
          style={{ color: RATING_BANDS[rating.rating].color }}
        >
          {RATING_BANDS[rating.rating].label}
        </p>
      </div>
    </section>
  );
}
