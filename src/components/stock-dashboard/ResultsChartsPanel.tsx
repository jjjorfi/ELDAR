import clsx from "clsx";
import type { MouseEvent } from "react";

import { LinesSkeleton } from "@/components/ui/FintechPrimitives";
import type { PriceRange } from "@/lib/features/price/types";

import { HackingValueText } from "@/components/stock-dashboard/view-helpers";
import { formatSignedPercent } from "@/components/stock-dashboard/data-helpers";

type OverlayPoint = {
  x: number;
  y: number;
  xLabel: string;
  yLabel: string;
};

type FundamentalsMetric = {
  label: string;
  value: number | null;
  signal: "BULLISH" | "NEUTRAL" | "BEARISH" | null;
  format?: "multiple" | "percent";
};

type FundamentalsSnapshot = {
  primaryValuation: FundamentalsMetric;
  revenueGrowth: FundamentalsMetric;
  epsGrowth: FundamentalsMetric;
  fcfYield: FundamentalsMetric;
};

interface ResultsChartsPanelProps {
  priceRange: PriceRange;
  priceRangeOptions: PriceRange[];
  onPriceRangeChange: (range: PriceRange) => void;
  priceHistoryChangePercent: number | null;
  priceHistoryLoading: boolean;
  priceHistory: Array<{ time: string; price: number }>;
  priceHistoryError: string;
  priceSparklinePath: string;
  priceChartOverlay: OverlayPoint | null;
  onPriceChartHoverIndex: (index: number) => void;

  fundamentalsSnapshot: FundamentalsSnapshot;
  fundamentalsNumbersLoading: boolean;
  fundamentalsHackTrigger: string;
  factorSignalToneClass: (signal: "BULLISH" | "NEUTRAL" | "BEARISH" | null) => string;

  scoreHistorySeries: Array<{ createdAt: string; score: number }>;
  scoreHistoryPoints: number[];
  scoreSparklinePath: string;
  scoreChartOverlay: OverlayPoint | null;
  onScoreChartHoverIndex: (index: number) => void;
}

function onChartMouseMove(
  event: MouseEvent<SVGSVGElement>,
  pointsLength: number,
  onHoverIndex: (index: number) => void
): void {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || pointsLength <= 1) return;
  const ratio = (event.clientX - rect.left) / rect.width;
  const index = Math.round(Math.max(0, Math.min(1, ratio)) * (pointsLength - 1));
  onHoverIndex(index);
}

export function ResultsChartsPanel({
  priceRange,
  priceRangeOptions,
  onPriceRangeChange,
  priceHistoryChangePercent,
  priceHistoryLoading,
  priceHistory,
  priceHistoryError,
  priceSparklinePath,
  priceChartOverlay,
  onPriceChartHoverIndex,
  fundamentalsSnapshot,
  fundamentalsNumbersLoading,
  fundamentalsHackTrigger,
  factorSignalToneClass,
  scoreHistorySeries,
  scoreHistoryPoints,
  scoreSparklinePath,
  scoreChartOverlay,
  onScoreChartHoverIndex
}: ResultsChartsPanelProps): JSX.Element {
  return (
    <>
      <div className="eldar-panel reveal-block rounded-3xl p-6" style={{ transitionDelay: "60ms" }}>
        <h2 className="mb-4 text-lg font-semibold text-white">PRICE CHART</h2>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {priceRangeOptions.map((windowSize) => (
              <button
                key={`price-window-${windowSize}`}
                type="button"
                onClick={() => onPriceRangeChange(windowSize)}
                className={clsx(
                  "min-h-[36px] rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition",
                  priceRange === windowSize
                    ? "border-amber-300/40 bg-amber-200/10 text-amber-100"
                    : "border-white/20 bg-white/[0.03] text-white/70"
                )}
              >
                {windowSize}
              </button>
            ))}
          </div>
          <p
            className={clsx(
              "text-sm font-semibold",
              (priceHistoryChangePercent ?? 0) > 0 && "text-emerald-300",
              (priceHistoryChangePercent ?? 0) < 0 && "text-red-300",
              priceHistoryChangePercent === null && "text-white/65"
            )}
          >
            <HackingValueText
              finalText={formatSignedPercent(priceHistoryChangePercent, 2)}
              loading={priceHistoryLoading}
              triggerKey={`${priceRange}:${priceHistory.length}:${priceHistoryChangePercent ?? "na"}`}
            />
          </p>
        </div>

        <div className="rounded-2xl border border-white/15 bg-zinc-950/45 p-4">
          {priceHistoryLoading ? (
            <LinesSkeleton rows={4} />
          ) : priceHistory.length >= 2 ? (
            <div className="space-y-2">
              <svg
                viewBox="0 0 720 220"
                className="h-44 w-full"
                preserveAspectRatio="none"
                aria-label="Price history chart"
                role="img"
                onMouseMove={(event) => onChartMouseMove(event, priceHistory.length, onPriceChartHoverIndex)}
              >
                <path d={priceSparklinePath} fill="none" stroke="rgba(255,191,0,0.88)" strokeWidth="2.4" strokeLinecap="round" />
                {priceChartOverlay ? (
                  <>
                    <line x1={priceChartOverlay.x} y1="0" x2={priceChartOverlay.x} y2="220" stroke="rgba(255,255,255,0.28)" strokeDasharray="4 3" />
                    <line x1="0" y1={priceChartOverlay.y} x2="720" y2={priceChartOverlay.y} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 4" />
                    <circle cx={priceChartOverlay.x} cy={priceChartOverlay.y} r="4.2" fill="#FFBF00" stroke="rgba(0,0,0,0.6)" strokeWidth="1.2" />
                  </>
                ) : null}
              </svg>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/72">
                <p className="font-mono">X: {priceChartOverlay?.xLabel ?? "N/A"}</p>
                <p className="font-mono">Y: {priceChartOverlay?.yLabel ?? "N/A"}</p>
                <p className="font-mono text-white/52">Axis: X=time • Y=price</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/60">{priceHistoryError || "Price history is not available yet."}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="eldar-panel reveal-block rounded-3xl p-6" style={{ transitionDelay: "70ms" }}>
          <h2 className="mb-4 text-lg font-semibold text-white">KEY FUNDAMENTALS</h2>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{fundamentalsSnapshot.primaryValuation.label}</p>
              <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.primaryValuation.signal))}>
                <HackingValueText
                  finalText={
                    fundamentalsSnapshot.primaryValuation.value !== null
                      ? fundamentalsSnapshot.primaryValuation.format === "percent"
                        ? formatSignedPercent(fundamentalsSnapshot.primaryValuation.value, 1)
                        : `${fundamentalsSnapshot.primaryValuation.value.toFixed(1)}x`
                      : "N/A"
                  }
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`pe:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Revenue Growth</p>
              <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.revenueGrowth.signal))}>
                <HackingValueText
                  finalText={formatSignedPercent(fundamentalsSnapshot.revenueGrowth.value, 1)}
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`rev:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">EPS Growth</p>
              <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.epsGrowth.signal))}>
                <HackingValueText
                  finalText={formatSignedPercent(fundamentalsSnapshot.epsGrowth.value, 1)}
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`eps:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">FCF Yield</p>
              <p className={clsx("mt-1 text-xl font-bold", factorSignalToneClass(fundamentalsSnapshot.fcfYield.signal))}>
                <HackingValueText
                  finalText={formatSignedPercent(fundamentalsSnapshot.fcfYield.value, 1)}
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`fcf:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
          </div>
        </div>

        <div className="eldar-panel reveal-block rounded-3xl p-6" style={{ transitionDelay: "75ms" }}>
          <h2 className="mb-4 text-lg font-semibold text-white">SCORE HISTORY</h2>
          <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-4 py-4">
            <svg
              viewBox="0 0 320 60"
              className="h-16 w-full"
              preserveAspectRatio="none"
              aria-label="Score history chart"
              role="img"
              onMouseMove={(event) => onChartMouseMove(event, scoreHistorySeries.length, onScoreChartHoverIndex)}
            >
              <path d={scoreSparklinePath} fill="none" stroke="rgba(245,245,245,0.88)" strokeWidth="2" strokeLinecap="round" />
              {scoreChartOverlay ? (
                <>
                  <line x1={scoreChartOverlay.x} y1="0" x2={scoreChartOverlay.x} y2="60" stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
                  <line x1="0" y1={scoreChartOverlay.y} x2="320" y2={scoreChartOverlay.y} stroke="rgba(255,255,255,0.16)" strokeDasharray="3 4" />
                  <circle cx={scoreChartOverlay.x} cy={scoreChartOverlay.y} r="3.6" fill="#F5F5F5" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
                </>
              ) : null}
            </svg>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
              <p className="font-mono">X: {scoreChartOverlay?.xLabel ?? "N/A"}</p>
              <p className="font-mono">Y: {scoreChartOverlay?.yLabel ?? "N/A"}</p>
              <p className="font-mono text-white/52">Axis: X=timestamp • Y=score</p>
            </div>
            <p className="mt-3 text-xs text-white/65">
              {scoreHistoryPoints[scoreHistoryPoints.length - 1] >= scoreHistoryPoints[0] ? "Improving trend" : "Deteriorating trend"}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
