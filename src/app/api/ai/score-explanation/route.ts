import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { generateScoreExplanation } from "@/lib/ai";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const FactorSchema = z.object({
  category: z.string(),
  factor: z.string(),
  weight: z.number(),
  bullishPoints: z.number(),
  bearishPoints: z.number(),
  points: z.number(),
  signal: z.enum(["BULLISH", "NEUTRAL", "BEARISH"]),
  ruleMatched: z.string(),
  metricValue: z.string(),
  hasData: z.boolean()
});

const RequestSchema = z.object({
  analysis: z.object({
    id: z.string(),
    createdAt: z.string(),
    generatedAt: z.string(),
    modelVersion: z.string(),
    symbol: z.string(),
    companyName: z.string(),
    sector: z.string(),
    currency: z.string(),
    currentPrice: z.number(),
    marketCap: z.number().nullable(),
    score: z.number(),
    rating: z.string(),
    ratingNote: z.string(),
    factors: z.array(FactorSchema),
    dataCompleteness: z.number(),
    entryAlert: z.object({
      priceZScore20d: z.number().nullable(),
      signal: z.string(),
      note: z.string()
    }),
    squeezeRisk: z.boolean(),
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
  })
});

/**
 * Returns a score explanation through the governed AI generation path.
 *
 * @param request - Incoming request with a persisted analysis payload.
 * @returns Structured explanation payload.
 */
export async function POST(request: Request) {
  const start = Date.now();

  try {
    const blocked = await runRouteGuards(request, {
      bucket: "api-ai-score-explanation",
      max: 45,
      windowMs: 60_000
    });
    if (blocked) {
      return blocked;
    }

    const body = RequestSchema.safeParse(await request.json());
    if (!body.success) {
      throw new ValidationError("Invalid score explanation request", {
        issues: body.error.flatten()
      });
    }

    const { userId } = await auth();
    const result = await generateScoreExplanation(body.data.analysis, userId ?? "anonymous");

    log({
      level: "info",
      service: "api-ai-score-explanation",
      message: "Score explanation resolved",
      symbol: body.data.analysis.symbol,
      source: result.source,
      cached: result.cached,
      durationMs: Date.now() - start
    });

    return okResponse(result, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return errorResponse(error, { route: "api-ai-score-explanation" });
  }
}
