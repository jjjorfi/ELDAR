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
  isFallback?: boolean;
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
  const withFallbackMarker = (text: string, isFallback?: boolean): string => {
    if (!isFallback || text === "N/A") return text;
    return `${text} *`;
  };

  return (
    <>
      <div className="eldar-panel eldar-price-card reveal-block rounded-3xl p-5" style={{ transitionDelay: "60ms" }}>
        <h2 className="mb-3 text-base font-semibold text-white/95">PRICE CHART</h2>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {priceRangeOptions.map((windowSize) => (
              <button
                key={`price-window-${windowSize}`}
                type="button"
                onClick={() => onPriceRangeChange(windowSize)}
                className={clsx(
                  "eldar-page-toggle min-h-[32px] rounded-lg px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition",
                  priceRange === windowSize
                    ? "border-white/35 bg-white/10 text-white"
                    : "text-white/70"
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

        <div className="eldar-price-chart-shell px-4 py-3">
          {priceHistoryLoading ? (
            <LinesSkeleton rows={4} />
          ) : priceHistory.length >= 2 ? (
            <div className="relative space-y-2">
              <div className="eldar-price-chart-grid" />
              {priceChartOverlay ? (
                <div
                  className="eldar-price-chart-tooltip"
                  style={{
                    left: `clamp(8px, calc(${(priceChartOverlay.x / 720) * 100}% - 54px), calc(100% - 112px))`,
                    top: `clamp(8px, calc(${(priceChartOverlay.y / 220) * 100}% - 54px), calc(100% - 64px))`
                  }}
                >
                  <p className="font-mono text-sm font-semibold text-white/90">{priceChartOverlay.yLabel}</p>
                  <p className="font-mono text-[10px] text-white/58">{priceChartOverlay.xLabel}</p>
                </div>
              ) : null}
              <svg
                viewBox="0 0 720 220"
                className="h-44 w-full"
                preserveAspectRatio="none"
                aria-label="Price history chart"
                role="img"
                onMouseMove={(event) => onChartMouseMove(event, priceHistory.length, onPriceChartHoverIndex)}
              >
                <defs>
                  <filter id="price-chart-glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="rgba(245,245,245,0.24)" />
                  </filter>
                </defs>
                <path
                  d={priceSparklinePath}
                  fill="none"
                  stroke="rgba(245,245,245,0.9)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  filter="url(#price-chart-glow)"
                />
                {priceChartOverlay ? (
                  <>
                    <line x1={priceChartOverlay.x} y1="0" x2={priceChartOverlay.x} y2="220" stroke="rgba(245,245,245,0.28)" strokeDasharray="4 4" />
                    <line x1="0" y1={priceChartOverlay.y} x2="720" y2={priceChartOverlay.y} stroke="rgba(245,245,245,0.16)" strokeDasharray="3 4" />
                    <circle cx={priceChartOverlay.x} cy={priceChartOverlay.y} r="4.4" fill="#f5f5f5" stroke="rgba(10,10,10,0.64)" strokeWidth="1.3" />
                  </>
                ) : null}
              </svg>
            </div>
          ) : (
            <p className="text-sm text-white/60">{priceHistoryError || "Price history is not available yet."}</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "70ms" }}>
          <h2 className="mb-3 text-base font-semibold text-white">KEY FUNDAMENTALS</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex min-h-[84px] flex-col justify-between rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{fundamentalsSnapshot.primaryValuation.label}</p>
              <p className={clsx("mt-1 text-lg font-semibold leading-none", factorSignalToneClass(fundamentalsSnapshot.primaryValuation.signal))}>
                <HackingValueText
                  finalText={withFallbackMarker(
                    fundamentalsSnapshot.primaryValuation.value !== null
                      ? fundamentalsSnapshot.primaryValuation.format === "percent"
                        ? formatSignedPercent(fundamentalsSnapshot.primaryValuation.value, 1)
                        : `${fundamentalsSnapshot.primaryValuation.value.toFixed(1)}x`
                      : "N/A",
                    fundamentalsSnapshot.primaryValuation.isFallback
                  )}
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`pe:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
            <div className="flex min-h-[84px] flex-col justify-between rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{fundamentalsSnapshot.revenueGrowth.label}</p>
              <p className={clsx("mt-1 text-lg font-semibold leading-none", factorSignalToneClass(fundamentalsSnapshot.revenueGrowth.signal))}>
                <HackingValueText
                  finalText={withFallbackMarker(
                    formatSignedPercent(fundamentalsSnapshot.revenueGrowth.value, 1),
                    fundamentalsSnapshot.revenueGrowth.isFallback
                  )}
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`rev:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
            <div className="flex min-h-[84px] flex-col justify-between rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{fundamentalsSnapshot.epsGrowth.label}</p>
              <p className={clsx("mt-1 text-lg font-semibold leading-none", factorSignalToneClass(fundamentalsSnapshot.epsGrowth.signal))}>
                <HackingValueText
                  finalText={withFallbackMarker(
                    formatSignedPercent(fundamentalsSnapshot.epsGrowth.value, 1),
                    fundamentalsSnapshot.epsGrowth.isFallback
                  )}
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`eps:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
            <div className="flex min-h-[84px] flex-col justify-between rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">{fundamentalsSnapshot.fcfYield.label}</p>
              <p className={clsx("mt-1 text-lg font-semibold leading-none", factorSignalToneClass(fundamentalsSnapshot.fcfYield.signal))}>
                <HackingValueText
                  finalText={withFallbackMarker(
                    formatSignedPercent(fundamentalsSnapshot.fcfYield.value, 1),
                    fundamentalsSnapshot.fcfYield.isFallback
                  )}
                  loading={fundamentalsNumbersLoading}
                  triggerKey={`fcf:${fundamentalsHackTrigger}`}
                />
              </p>
            </div>
          </div>
        </div>

        <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "75ms" }}>
          <h2 className="mb-3 text-base font-semibold text-white">SCORE HISTORY</h2>
          <div className="rounded-xl border border-white/15 bg-zinc-950/45 px-4 py-3">
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
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-white/72">
              <p className="font-mono">X: {scoreChartOverlay?.xLabel ?? "N/A"}</p>
              <p className="font-mono text-right">Y: {scoreChartOverlay?.yLabel ?? "N/A"}</p>
            </div>
            <p className="mt-2 text-xs text-white/65">
              {scoreHistoryPoints[scoreHistoryPoints.length - 1] >= scoreHistoryPoints[0] ? "Improving trend" : "Deteriorating trend"}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
