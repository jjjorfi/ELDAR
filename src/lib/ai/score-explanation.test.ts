import assert from "node:assert/strict";
import test from "node:test";

import { generateScoreExplanation } from "@/lib/ai/score-explanation";
import type { PersistedAnalysis } from "@/lib/types";

const analysis: PersistedAnalysis = {
  id: "test-1",
  createdAt: "2026-03-13T00:00:00.000Z",
  generatedAt: "2026-03-13T00:00:00.000Z",
  modelVersion: "v1",
  symbol: "AAPL",
  companyName: "Apple Inc.",
  sector: "Technology",
  currency: "USD",
  currentPrice: 210,
  marketCap: 3_000_000_000_000,
  score: 8.4,
  rating: "BUY",
  ratingNote: "Upper-quartile composite with broad factor support.",
  factors: [
    {
      category: "Fundamental",
      factor: "Growth",
      weight: 2,
      bullishPoints: 2,
      bearishPoints: 0,
      points: 2,
      signal: "BULLISH",
      ruleMatched: "Revenue growth > 10%",
      metricValue: "12.00%",
      hasData: true
    },
    {
      category: "Valuation",
      factor: "Valuation",
      weight: 2,
      bullishPoints: 0,
      bearishPoints: 1,
      points: -1,
      signal: "BEARISH",
      ruleMatched: "Forward PE elevated",
      metricValue: "29.00x",
      hasData: true
    }
  ],
  dataCompleteness: 1,
  entryAlert: {
    priceZScore20d: 0.2,
    signal: "NEUTRAL",
    note: "Neutral"
  },
  squeezeRisk: false,
  fundamentals: {
    forwardPE: 29,
    trailingPE: 31,
    peBasis: "NTM",
    revenueGrowth: 0.12,
    earningsQuarterlyGrowth: 0.1,
    epsGrowthBasis: "YOY",
    fcfYield: 0.031,
    evEbitda: 22,
    ffoYield: null
  }
};

test("generateScoreExplanation falls back deterministically without provider credentials", async () => {
  const previousKey = process.env.HF_API_KEY;
  process.env.HF_API_KEY = "";

  try {
    const result = await generateScoreExplanation(analysis, "test-user");
    assert.equal(result.source, "fallback");
    assert.equal(result.sections.conviction, "BUY");
    assert.ok(result.sections.rationale.some((item) => item.includes("Growth")));
    assert.ok(result.sections.risks.some((item) => item.includes("Valuation")));
  } finally {
    process.env.HF_API_KEY = previousKey;
  }
});
