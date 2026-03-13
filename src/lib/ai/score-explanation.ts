import { z } from "zod";

import { generateAnswerForUser, type GeneratedAnswer } from "@/lib/ai/generate";
import {
  buildScoreExplanationFallbackSections,
  ScoreExplanationAnalysisSchema,
  type ScoreExplanationAnalysis,
  type ScoreExplanationSections
} from "@/lib/ai/score-explanation-shared";
import { ELDAR_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { env } from "@/lib/env";

export type ScoreExplanationResponse = GeneratedAnswer & {
  sections: ScoreExplanationSections;
};

function formatPercent(value: number | null): string {
  return value === null ? "data not provided" : `${(value * 100).toFixed(2)}%`;
}

function formatMultiple(value: number | null): string {
  return value === null ? "data not provided" : value.toFixed(2);
}

function buildPrompt(analysis: z.infer<typeof ScoreExplanationAnalysisSchema>): string {
  const topFactors = [...analysis.factors]
    .filter((factor) => factor.hasData)
    .sort((left, right) => right.points - left.points)
    .slice(0, 3)
    .map((factor) => `${factor.factor}: ${factor.signal} (${factor.metricValue})`);

  const weakFactors = [...analysis.factors]
    .filter((factor) => factor.hasData)
    .sort((left, right) => left.points - right.points)
    .slice(0, 2)
    .map((factor) => `${factor.factor}: ${factor.signal} (${factor.metricValue})`);

  return [
    `Ticker: ${analysis.symbol}`,
    `Company: ${analysis.companyName}`,
    `Sector: ${analysis.sector}`,
    `Score: ${analysis.score.toFixed(2)}`,
    `Rating: ${analysis.rating}`,
    `Rating note: ${analysis.ratingNote}`,
    `Top factors: ${topFactors.join(" | ") || "data not provided"}`,
    `Weak factors: ${weakFactors.join(" | ") || "data not provided"}`,
    `Forward PE: ${formatMultiple(analysis.fundamentals.forwardPE)}`,
    `Trailing PE: ${formatMultiple(analysis.fundamentals.trailingPE)}`,
    `Revenue growth: ${formatPercent(analysis.fundamentals.revenueGrowth)}`,
    `Earnings growth: ${formatPercent(analysis.fundamentals.earningsQuarterlyGrowth)}`,
    `FCF yield: ${formatPercent(analysis.fundamentals.fcfYield)}`,
    `EV/EBITDA: ${formatMultiple(analysis.fundamentals.evEbitda)}`,
    `FFO yield: ${formatPercent(analysis.fundamentals.ffoYield)}`,
    "Use the exact values above only. If a value is missing, write data not provided."
  ].join("\n");
}

function parseSections(content: string): ScoreExplanationSections | null {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections: ScoreExplanationSections = {
    conviction: "",
    rationale: [],
    keyMetrics: [],
    risks: []
  };

  let current: keyof ScoreExplanationSections | null = null;
  for (const line of lines) {
    const normalized = line.replace(/\*\*/g, "").toLowerCase();
    if (normalized.startsWith("conviction:")) {
      sections.conviction = line.split(":").slice(1).join(":").trim();
      current = "conviction";
      continue;
    }
    if (normalized.startsWith("rationale:")) {
      current = "rationale";
      continue;
    }
    if (normalized.startsWith("key metrics:")) {
      current = "keyMetrics";
      continue;
    }
    if (normalized.startsWith("risks:")) {
      current = "risks";
      continue;
    }
    if (line.startsWith("-") && current && current !== "conviction") {
      sections[current].push(line.replace(/^-\s*/, ""));
      continue;
    }
    if (current === "conviction" && !sections.conviction) {
      sections.conviction = line;
    }
  }

  if (!sections.conviction || sections.rationale.length === 0) {
    return null;
  }

  return sections;
}

function sectionsToContent(sections: ScoreExplanationSections): string {
  return [
    `Conviction: ${sections.conviction}`,
    "Rationale:",
    ...sections.rationale.map((item) => `- ${item}`),
    "Key Metrics:",
    ...sections.keyMetrics.map((item) => `- ${item}`),
    "Risks:",
    ...sections.risks.map((item) => `- ${item}`)
  ].join("\n");
}

/**
 * Generates a cache-first score explanation for a stock analysis result.
 *
 * @param analysisInput - Structured deterministic analysis payload.
 * @param userKey - Stable user or anonymous key for quota accounting.
 * @returns Structured explanation sections and generation metadata.
 */
export async function generateScoreExplanation(
  analysisInput: ScoreExplanationAnalysis,
  userKey: string
): Promise<ScoreExplanationResponse> {
  const analysis = ScoreExplanationAnalysisSchema.parse(analysisInput);
  const prompt = buildPrompt(analysis);
  const fallbackSections = buildScoreExplanationFallbackSections(analysis);
  const result = await generateAnswerForUser({
    userKey,
    cache: {
      scope: `score-explanation:${analysis.symbol.toUpperCase()}`,
      model: env.HF_MODEL_SMALL,
      prompt
    },
    system: ELDAR_SYSTEM_PROMPT,
    userPrompt: prompt,
    provider: {
      modelTier: "small",
      maxTokens: 220,
      temperature: 0.2
    },
    fallback: () => sectionsToContent(fallbackSections)
  });

  return {
    ...result,
    sections: parseSections(result.content) ?? fallbackSections,
    content: result.source === "fallback" ? sectionsToContent(fallbackSections) : result.content
  };
}
