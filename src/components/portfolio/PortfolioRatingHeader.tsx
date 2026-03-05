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
  const returnMetric = rating.pillars.find((pillar) => pillar.key === "return")?.metrics?.cagr;
  const maxDdMetric = rating.pillars.find((pillar) => pillar.key === "drawdown")?.metrics?.maxDrawdown;
  const shapeClip = "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)";

  return (
    <section className="eldar-panel rounded-2xl p-5">
      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_280px] xl:items-center">
        <div className="mx-auto w-full max-w-[220px]">
          <div className="relative h-[200px] w-[200px]">
            <div
              className="pointer-events-none absolute inset-0 bg-amber-300/20 blur-2xl"
              style={{ clipPath: shapeClip }}
            />
            <div
              className="absolute inset-0 border border-amber-300/45 bg-amber-200/10"
              style={{ clipPath: shapeClip, boxShadow: "0 0 22px rgba(255,191,0,0.25)" }}
            />
            <div
              className="absolute inset-[14px] border border-white/15 bg-black/45"
              style={{ clipPath: shapeClip }}
            >
              <div className="flex h-full w-full flex-col items-center justify-center text-center">
                <p className="font-mono text-4xl font-black text-white">{rating.compositeScore.toFixed(1)}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/60">Portfolio Score</p>
              </div>
            </div>
          </div>
        </div>

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
          {typeof returnMetric === "string" || typeof maxDdMetric === "string" ? (
            <div className="mt-2 flex items-center gap-2 text-xs">
              {typeof returnMetric === "string" ? <span className="text-[#22C55E]">{returnMetric} CAGR</span> : null}
              {typeof returnMetric === "string" && typeof maxDdMetric === "string" ? <span className="text-[#555]">·</span> : null}
              {typeof maxDdMetric === "string" ? <span className="text-[#EF4444]">{maxDdMetric} Max DD</span> : null}
            </div>
          ) : null}
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
