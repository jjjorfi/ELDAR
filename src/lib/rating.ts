import type { RatingLabel } from "@/lib/types";

export const RATING_BANDS: Record<
  RatingLabel,
  {
    min: number;
    max: number;
    label: string;
    explanation: string;
    color: "#B91C1C" | "#EF4444" | "#6B7280" | "#10B981" | "#059669";
  }
> = {
  STRONG_BUY: {
    min: 8.1,
    max: 10,
    label: "STRONGLY BULLISH",
    explanation: "Strong upside momentum with broad confirmation",
    color: "#059669"
  },
  BUY: {
    min: 6.1,
    max: 8.0,
    label: "BULLISH",
    explanation: "Bullish setup with favorable conditions",
    color: "#10B981"
  },
  HOLD: {
    min: 4.1,
    max: 6.0,
    label: "NEUTRAL",
    explanation: "Balanced setup, monitor for a directional break",
    color: "#6B7280"
  },
  SELL: {
    min: 2.1,
    max: 4.0,
    label: "BEARISH",
    explanation: "Weak setup - reduce exposure",
    color: "#EF4444"
  },
  STRONG_SELL: {
    min: 0,
    max: 2.0,
    label: "STRONGLY BEARISH",
    explanation: "High downside risk - avoid or hedge",
    color: "#B91C1C"
  }
};

export function toRating(score: number): RatingLabel {
  if (score > 8.0) return "STRONG_BUY";
  if (score > 6.0) return "BUY";
  if (score > 4.0) return "HOLD";
  if (score > 2.0) return "SELL";
  return "STRONG_SELL";
}

export function ratingNote(score: number): string {
  const rating = toRating(score);
  return RATING_BANDS[rating].explanation;
}
