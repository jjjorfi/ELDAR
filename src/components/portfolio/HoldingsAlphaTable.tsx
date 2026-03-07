"use client";

import { useState } from "react";

import type { PortfolioRating } from "@/lib/scoring/portfolio-types";
import { RATING_BANDS } from "@/lib/rating";

export function HoldingsAlphaTable({ rating }: { rating: PortfolioRating }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const weightedAverage =
    rating.holdings.reduce((sum, holding) => sum + (holding.eldarScore ?? 0) * holding.weight, 0);
  const visibleHoldings = expanded ? rating.holdings : rating.holdings.slice(0, 8);
  const hiddenCount = Math.max(0, rating.holdings.length - visibleHoldings.length);

  return (
    <section className="card-grain p-2">
      <h3 className="text-[10px] uppercase tracking-[0.12em] text-white/55">Holdings Alpha Table</h3>
      <div className="mt-2.5 overflow-hidden">
        <div className="grid grid-cols-[84px_minmax(180px,1fr)_86px_120px_90px] gap-2 border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-white/55">
          <span>Ticker</span>
          <span>Weight</span>
          <span className="text-right">Score</span>
          <span className="text-right">Rating</span>
          <span className="text-right">Contrib</span>
        </div>
        <div className="max-h-[280px] overflow-auto">
          {visibleHoldings.map((holding) => {
            const band = holding.rating ? RATING_BANDS[holding.rating] : null;
            return (
              <div key={holding.ticker} className="grid grid-cols-[84px_minmax(180px,1fr)_86px_120px_90px] items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-white/85 last:border-b-0">
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-white">{holding.ticker}</p>
                  <p className="truncate text-[10px] text-white/60">{holding.name}</p>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="text-white/70">{(holding.weight * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-zinc-200/80" style={{ width: `${Math.max(2, Math.min(100, holding.weight * 100))}%` }} />
                  </div>
                </div>

                <p className="text-right font-mono text-white">
                  {holding.eldarScore !== null ? holding.eldarScore.toFixed(1) : "—"}
                </p>

                <div className="flex justify-end">
                  <span
                    className="rounded-md border px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
                    style={{
                      color: band?.color ?? "#6B7280",
                      borderColor: `${band?.color ?? "#6B7280"}55`,
                      background: `${band?.color ?? "#6B7280"}18`
                    }}
                  >
                    {band?.label ?? "UNRATED"}
                  </span>
                </div>

                <p className="text-right font-mono text-white">{holding.contribution.toFixed(3)}</p>
              </div>
            );
          })}
        </div>
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-[9px] uppercase tracking-[0.12em] text-[#FFBF00]"
        >
          {expanded ? "Show less ↑" : `Show ${hiddenCount} more ↓`}
        </button>
      ) : null}
      <div className="mt-3 flex items-center justify-between text-xs">
        <p className="text-white/60">Weighted average ELDAR score</p>
        <p className="font-mono text-white">{weightedAverage.toFixed(2)}</p>
      </div>
    </section>
  );
}
