import { useEffect, useState } from "react";

import { RATING_BANDS } from "@/lib/rating";
import type { Mag7ScoreCard, PersistedAnalysis, RatingLabel } from "@/lib/types";

export interface AnalysisRadarOverlayProps {
  symbol: string | null;
  phase: "idle" | "fetching" | "rendering";
}

export function AnalysisRadarOverlay({ symbol, phase }: AnalysisRadarOverlayProps): JSX.Element {
  return (
    <div className="eldar-radar-overlay fixed inset-0 z-[80] flex items-center justify-center px-6">
      <div className="eldar-radar-panel rounded-3xl border border-white/20 px-8 py-7 text-center backdrop-blur-xl">
        <div className="eldar-sci-loader mx-auto mb-5" aria-hidden="true">
          <span className="eldar-sci-ring eldar-sci-ring-outer" />
          <span className="eldar-sci-ring eldar-sci-ring-mid" />
          <span className="eldar-sci-ring eldar-sci-ring-inner" />
          <span className="eldar-sci-orbit eldar-sci-orbit-a" />
          <span className="eldar-sci-orbit eldar-sci-orbit-b" />
          <span className="eldar-sci-core" />
          <span className="eldar-sci-grid" />
        </div>
        <p className="eldar-caption text-[10px] text-white/65">ANALYZING {symbol ? `$${symbol}` : "SYMBOL"}</p>
        <p className="mt-2 text-sm text-white/82">
          {phase === "fetching" ? "Pulling live market data..." : "Finalizing full analysis..."}
        </p>
      </div>
    </div>
  );
}

export function scoreLabel(score: number): string {
  const formatted = Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1);
  return score > 0 ? `+${formatted}` : formatted;
}

export function ratingToneByLabel(rating: RatingLabel): "bullish" | "neutral" | "bearish" {
  if (rating === "STRONG_BUY" || rating === "BUY") return "bullish";
  if (rating === "STRONG_SELL" || rating === "SELL") return "bearish";
  return "neutral";
}

export function ratingLabelFromKey(rating: RatingLabel): string {
  return RATING_BANDS[rating].label;
}

export function ratingLabelToneClass(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("strongly bullish") || normalized.includes("strong buy")) return "text-[#FFBF00]";
  if (normalized.includes("bullish") || normalized.includes("buy")) return "text-emerald-300";
  if (normalized.includes("bearish") || normalized.includes("sell")) return "text-red-300";
  return "text-slate-300";
}

export function percentWithSign(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function sectorHeatFromScore(score: number): "HOT" | "NEUTRAL" | "COLD" {
  if (score >= 7) return "HOT";
  if (score >= 5) return "NEUTRAL";
  return "COLD";
}

export function sectorHeatLabel(heat: "HOT" | "NEUTRAL" | "COLD"): string {
  return heat;
}

export function toConfidenceLevel(dataCompleteness: number): "HIGH" | "MEDIUM" | "LOW" {
  if (dataCompleteness >= 0.9) return "HIGH";
  if (dataCompleteness >= 0.7) return "MEDIUM";
  return "LOW";
}

function scoreFactorBucket(
  factors: PersistedAnalysis["factors"],
  matcher: (factor: PersistedAnalysis["factors"][number]) => boolean
): number {
  const selected = factors.filter((factor) => factor.hasData && matcher(factor));
  if (selected.length === 0) return 0;
  const totalWeight = selected.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight <= 0) return 0;
  const totalPoints = selected.reduce((sum, factor) => sum + factor.points, 0);
  return Math.max(0, Math.min(10, (totalPoints / totalWeight) * 10));
}

export function buildComparisonFactorTuple(analysis: PersistedAnalysis): [number, number, number, number] {
  const fundamentals = scoreFactorBucket(
    analysis.factors,
    (factor) => factor.category === "Fundamental" || factor.category === "Valuation"
  );
  const momentum = scoreFactorBucket(analysis.factors, (factor) => factor.category === "Technical");
  const valuation = scoreFactorBucket(analysis.factors, (factor) => factor.category === "Valuation");
  const sentiment = scoreFactorBucket(
    analysis.factors,
    (factor) => factor.category === "Sentiment" || factor.category === "Macro"
  );
  return [fundamentals, momentum, valuation, sentiment];
}

export interface HackingScoreProps {
  value: number;
  triggerKey: string;
  className?: string;
  durationMs?: number;
}

export function HackingScore({ value, triggerKey, className, durationMs = 200 }: HackingScoreProps): JSX.Element {
  const [displayValue, setDisplayValue] = useState<number>(value);

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setDisplayValue(0);
      return;
    }

    let rafId = 0;
    const start = performance.now();

    const animate = (now: number): void => {
      const elapsed = now - start;
      if (elapsed >= durationMs) {
        setDisplayValue(value);
        return;
      }

      const progress = elapsed / durationMs;
      const jitter = (1 - progress) * 2.4;
      const noise = (Math.random() - 0.5) * jitter;
      const next = Math.max(0, Math.min(10, value + noise));
      setDisplayValue(next);
      rafId = window.requestAnimationFrame(animate);
    };

    rafId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(rafId);
  }, [value, triggerKey, durationMs]);

  return <span className={className}>{displayValue.toFixed(1)}</span>;
}

export interface HackingValueTextProps {
  finalText: string;
  loading: boolean;
  triggerKey: string;
  className?: string;
  settleDurationMs?: number;
}

function hackerizeText(text: string): string {
  if (!text || text === "N/A") {
    return `${Math.random() > 0.5 ? "+" : "−"}${(Math.random() * 99).toFixed(1)}%`;
  }

  return text
    .replace(/[0-9]/g, () => String(Math.floor(Math.random() * 10)))
    .replace(/[+\-−]/g, () => (Math.random() > 0.5 ? "+" : "−"));
}

export function HackingValueText({
  finalText,
  loading,
  triggerKey,
  className,
  settleDurationMs = 300
}: HackingValueTextProps): JSX.Element {
  const [displayText, setDisplayText] = useState<string>(finalText);
  const [isHacking, setIsHacking] = useState<boolean>(true);

  useEffect(() => {
    let timeoutId: number | null = null;

    setIsHacking(true);
    if (!loading) {
      timeoutId = window.setTimeout(() => {
        setIsHacking(false);
      }, settleDurationMs);
    }

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [loading, triggerKey, settleDurationMs]);

  useEffect(() => {
    if (!isHacking) {
      setDisplayText(finalText);
      return;
    }

    const tick = (): void => {
      setDisplayText(hackerizeText(finalText));
    };

    tick();
    const intervalId = window.setInterval(tick, 65);
    return () => window.clearInterval(intervalId);
  }, [isHacking, finalText]);

  return <span className={className}>{displayText}</span>;
}

export function formatOptionalDecimal(value: number | null | undefined, digits = 2): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value.toFixed(digits);
}

export function formatEarningsDate(value: string | null): string {
  if (!value) return "TBD";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "TBD";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatChartDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dedupeSearchResultsBySymbol<T extends { symbol: string }>(results: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of results) {
    if (seen.has(item.symbol)) {
      continue;
    }

    seen.add(item.symbol);
    deduped.push(item);
  }

  return deduped;
}

export function sortMag7Cards(cards: Mag7ScoreCard[]): Mag7ScoreCard[] {
  const rank = (value: number | null): number => (typeof value === "number" && Number.isFinite(value) ? value : -Infinity);
  return [...cards].sort(
    (a, b) => rank(b.changePercent) - rank(a.changePercent) || b.score - a.score || a.symbol.localeCompare(b.symbol)
  );
}

export function buildSparklinePath(points: number[], width: number, height: number): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M0 ${height / 2} L${width} ${height / 2}`;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 0.000001);

  return points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const angle = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  };
}

export function describeDonutSlicePath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z"
  ].join(" ");
}

export function scoreBandColor(score: number | null): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "#6B7280";
  if (score >= 7.9) return "#FFBF00";
  if (score >= 6.3) return "#10B981";
  if (score >= 4.1) return "#6B7280";
  if (score >= 2.8) return "#EF4444";
  return "#B91C1C";
}
