import clsx from "clsx";

import { RATING_BANDS } from "@/lib/rating";
import type { PortfolioRating } from "@/lib/scoring/portfolio-types";

const TOOLTIP_TEXT =
  "Portfolio rating is based on trailing historical performance and current holdings composition. " +
  "It is not a forecast of future returns. Ratings are peer-relative within the classified peer group. " +
  "Minimum 12 months required; 36 months for full confidence. Gating may cap extreme ratings when coverage is low.";

function renderStars(stars: number): string {
  return "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
}

export function PortfolioRatingHeader({ rating }: { rating: PortfolioRating }): JSX.Element {
  const band = RATING_BANDS[rating.rating];
  const segments = 6;
  const filledSegments = Math.max(0, Math.min(segments, Math.round(rating.dataCompleteness * segments)));

  return (
    <section className="eldar-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Portfolio Rating</p>
          <div className="mt-1 flex items-center gap-3">
            <p className="font-mono text-2xl font-bold text-white">{renderStars(rating.stars)}</p>
            <p className="font-mono text-2xl font-bold text-white">{rating.compositeScore.toFixed(1)} / 10</p>
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: band.color }}>
            {band.label}
          </p>
          <p className="mt-1 text-xs text-white/60">Rated vs: {rating.peerGroup} peers</p>
        </div>

        <div className="min-w-[240px] rounded-xl border border-white/15 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Data Completeness</p>
            <details className="group relative">
              <summary className="cursor-pointer list-none text-xs text-white/65">ⓘ</summary>
              <div className="absolute right-0 z-10 mt-2 w-72 rounded-lg border border-white/20 bg-zinc-950/95 p-2 text-[10px] leading-relaxed text-white/80">
                {TOOLTIP_TEXT}
              </div>
            </details>
          </div>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: segments }).map((_, index) => (
              <span
                key={`segment-${index}`}
                className={clsx(
                  "h-2 border border-white/20",
                  index < filledSegments ? "bg-white/70" : "bg-white/10"
                )}
              />
            ))}
          </div>
          {rating.confidenceFlags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rating.confidenceFlags.map((flag) => (
                <span key={flag} className="rounded-md border border-amber-300/40 bg-amber-200/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                  ⚠ {flag.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-emerald-300">✓ Full confidence band active</p>
          )}
        </div>
      </div>
    </section>
  );
}

