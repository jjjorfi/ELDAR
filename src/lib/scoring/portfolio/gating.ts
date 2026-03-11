import type { RatingLabel } from "@/lib/types";

export interface ConfidenceGateInput {
  rating: RatingLabel;
  monthsOfHistory: number;
  dataCompleteness: number;
}

export interface ConfidenceGateOutput {
  rating: RatingLabel;
  confidenceFlags: string[];
}

export function applyConfidenceGates(input: ConfidenceGateInput): ConfidenceGateOutput {
  let nextRating = input.rating;
  const flags: string[] = [];

  if (input.monthsOfHistory < 12) {
    flags.push("history_lt_12m");
  }

  if (input.dataCompleteness < 0.65) {
    flags.push("low_completeness");
  }

  if (flags.length > 0) {
    if (nextRating === "STRONG_BUY") nextRating = "BUY";
    if (nextRating === "STRONG_SELL") nextRating = "SELL";
  }

  return {
    rating: nextRating,
    confidenceFlags: flags
  };
}

