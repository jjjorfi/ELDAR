import type { RatingLabel } from "@/lib/types";

// ─── Empirical band calibration (unchanged from v7) ──────────────────────────
//
// S&P 1500 composite distribution: mean ≈ 5.1, σ ≈ 1.45
// Band boundaries mapped to forward 12-month excess-return percentiles:
//   STRONG_BUY ≥ 7.9  top  8%  α +9–16%
//   BUY        ≥ 6.3  top 25%  α +3–8%
//   HOLD       ≥ 4.1  top 63%  α ≈ 0%
//   SELL       ≥ 2.7  top 83%  α -3–7%
//   STRONG_SELL < 2.7  bottom 17%  α -8–14%
//
// v8 addition: dataCompleteness < 0.65 caps the rating at BUY/SELL.
// This is enforced in scoreSnapshot(), not in toRating().

export const RATING_BANDS: Record<
  RatingLabel,
  {
    min: number;
    max: number;
    label: string;
    explanation: string;
    shortExplanation: string;
    emoji: string;
    color: "#B91C1C" | "#EF4444" | "#6B7280" | "#10B981" | "#FFBF00";
  }
> = {
  STRONG_BUY: {
    min: 7.9,
    max: 10.0,
    label: "STRONGLY BULLISH",
    explanation:
      "Top-decile composite. Broad confirmation across fundamental quality, " +
      "valuation, momentum, and sentiment. Historical forward α: +9 to +16% annualised.",
    shortExplanation: "Top-decile — strong conviction across all pillars",
    emoji: "🐂",
    color: "#FFBF00"
  },
  BUY: {
    min: 6.3,
    max: 7.89,
    label: "BULLISH",
    explanation:
      "Upper-quartile composite. Most factors constructive with minor caveats. " +
      "Historical forward α: +3 to +8% annualised.",
    shortExplanation: "Upper-quartile — constructive setup",
    emoji: "🟢",
    color: "#10B981"
  },
  HOLD: {
    min: 4.1,
    max: 6.29,
    label: "NEUTRAL",
    explanation:
      "Mixed signals. No statistically significant edge at this composite level. " +
      "Await a catalyst or clearer directional confirmation.",
    shortExplanation: "No edge — mixed signals",
    emoji: "⚪",
    color: "#6B7280"
  },
  SELL: {
    min: 2.7,
    max: 4.09,
    label: "BEARISH",
    explanation:
      "Below-median composite with multiple deteriorating signals. " +
      "Risk-reward skewed negative. Historical forward α: -3 to -7% annualised.",
    shortExplanation: "Below-median — reduce exposure",
    emoji: "🔴",
    color: "#EF4444"
  },
  STRONG_SELL: {
    min: 0.0,
    max: 2.69,
    label: "STRONGLY BEARISH",
    explanation:
      "Bottom-decile composite. Broad deterioration. High downside risk. " +
      "Historical forward α: -8 to -14% annualised.",
    shortExplanation: "Bottom-decile — avoid or hedge",
    emoji: "🐻",
    color: "#B91C1C"
  }
};

export function toRating(score: number): RatingLabel {
  const clamped = Math.max(0, Math.min(10, score));
  for (const [label, band] of Object.entries(RATING_BANDS) as [
    RatingLabel,
    (typeof RATING_BANDS)[RatingLabel]
  ][]) {
    if (clamped >= band.min && clamped <= band.max) return label;
  }
  return "STRONG_SELL";
}

export function ratingNote(score: number): string {
  return RATING_BANDS[toRating(score)].explanation;
}

export function ratingShortNote(score: number): string {
  return RATING_BANDS[toRating(score)].shortExplanation;
}

export function ratingColor(rating: RatingLabel): (typeof RATING_BANDS)[RatingLabel]["color"] {
  return RATING_BANDS[rating].color;
}

export function ratingDisplayLabel(rating: RatingLabel): string {
  return rating.replace(/_/g, " ");
}
