import { z } from "zod";

const SharedFactorSchema = z.object({
  factor: z.string(),
  points: z.number(),
  signal: z.enum(["BULLISH", "NEUTRAL", "BEARISH"]),
  metricValue: z.string(),
  hasData: z.boolean()
});

export const ScoreExplanationAnalysisSchema = z.object({
  symbol: z.string().min(1),
  companyName: z.string().min(1),
  sector: z.string().min(1),
  score: z.number(),
  rating: z.string().min(1),
  ratingNote: z.string().min(1),
  factors: z.array(SharedFactorSchema),
  fundamentals: z.object({
    forwardPE: z.number().nullable(),
    trailingPE: z.number().nullable(),
    peBasis: z.string(),
    revenueGrowth: z.number().nullable(),
    earningsQuarterlyGrowth: z.number().nullable(),
    epsGrowthBasis: z.string(),
    fcfYield: z.number().nullable(),
    evEbitda: z.number().nullable(),
    ffoYield: z.number().nullable()
  })
});

export type ScoreExplanationAnalysis = z.infer<typeof ScoreExplanationAnalysisSchema>;

export type ScoreExplanationSections = {
  conviction: string;
  rationale: string[];
  keyMetrics: string[];
  risks: string[];
};

function formatPercent(value: number | null): string {
  return value === null ? "data not provided" : `${(value * 100).toFixed(2)}%`;
}

/**
 * Builds the deterministic fallback explanation used whenever the provider path
 * is unavailable or parsing fails.
 *
 * @param analysis - Structured analysis payload.
 * @returns Stable explanation sections using exact provided values only.
 */
export function buildScoreExplanationFallbackSections(
  analysis: ScoreExplanationAnalysis
): ScoreExplanationSections {
  const ranked = [...analysis.factors]
    .filter((factor) => factor.hasData)
    .sort((left, right) => right.points - left.points);
  const weakest = [...analysis.factors]
    .filter((factor) => factor.hasData)
    .sort((left, right) => left.points - right.points);

  const lead = ranked[0];
  const secondary = ranked[1];
  const drag = weakest[0];

  return {
    conviction: analysis.rating.replaceAll("_", " "),
    rationale: [
      lead ? `${lead.factor} leads at ${lead.metricValue}.` : analysis.ratingNote,
      secondary ? `${secondary.factor} also supports the score at ${secondary.metricValue}.` : "Secondary driver data not provided.",
      drag ? `${drag.factor} is the main drag at ${drag.metricValue}.` : "Main drag data not provided."
    ],
    keyMetrics: [
      `Score ${analysis.score.toFixed(2)} with ${analysis.rating.replaceAll("_", " ")}.`,
      `Revenue growth ${formatPercent(analysis.fundamentals.revenueGrowth)}.`,
      `FCF yield ${formatPercent(analysis.fundamentals.fcfYield)}.`
    ],
    risks: [
      drag ? `${drag.factor} remains the clearest risk.` : "Risk data not provided.",
      analysis.ratingNote
    ]
  };
}
