import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiAuthContext } from "@/lib/api/auth-context";
import {
  badRequest,
  internalServerError,
  jsonNoStore,
  unauthorized
} from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { isTop100Sp500Symbol } from "@/lib/market/top100";
import { scorePortfolio } from "@/lib/scoring/portfolio-engine";
import type { PortfolioInputHolding } from "@/lib/scoring/portfolio-types";
import { getLatestPortfolioSnapshot, savePortfolioSnapshot } from "@/lib/storage";

export const runtime = "nodejs";

const ratingLabelSchema = z.enum(["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]);

const holdingSchema = z.object({
  ticker: z.string().min(1).max(12),
  name: z.string().min(1).max(160),
  weight: z.number().min(0).max(1),
  shares: z.number().int().min(1).max(10_000_000),
  price: z.number().positive().nullable(),
  sector: z.string().max(120).nullable(),
  eldarScore: z.number().min(0).max(10).nullable(),
  rating: ratingLabelSchema.nullable()
});

const payloadSchema = z.object({
  portfolioId: z.string().min(1).max(64).optional(),
  asOfDate: z.string().min(8).max(16).optional(),
  benchmarkPoints: z.array(z.number().finite()).max(1000).default([]),
  monthsOfHistory: z.number().int().min(1).max(1200).optional(),
  holdings: z.array(holdingSchema).min(1).max(200)
});

function normalizeHoldings(holdings: PortfolioInputHolding[]): PortfolioInputHolding[] {
  return holdings
    .map((holding) => ({
      ...holding,
      ticker: holding.ticker.trim().toUpperCase(),
      name: holding.name.trim() || holding.ticker.trim().toUpperCase(),
      sector: holding.sector ? holding.sector.trim() : null
    }))
    .filter((holding) => holding.ticker.length > 0 && holding.shares > 0);
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-portfolio-get",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId } = authContext;

    const { searchParams } = new URL(request.url);
    const portfolioId = (searchParams.get("portfolioId") ?? "default").trim() || "default";
    const snapshot = await getLatestPortfolioSnapshot(userId, portfolioId);

    return jsonNoStore({ snapshot });
  } catch (error) {
    console.error("/api/portfolio GET error", error);
    return internalServerError("Failed to load portfolio snapshot.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-portfolio-post",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId } = authContext;

    const rawBody = await request.json();
    const parsed = payloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return badRequest("Invalid portfolio payload.");
    }

    const portfolioId = (parsed.data.portfolioId ?? "default").trim() || "default";
    const asOfDate = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
    const holdings = normalizeHoldings(parsed.data.holdings);
    if (holdings.length === 0) {
      return badRequest("Portfolio holdings are empty.");
    }

    const hasUnsupported = holdings.some((holding) => !isTop100Sp500Symbol(holding.ticker));
    if (hasUnsupported) {
      return badRequest("Portfolio supports Top 100 S&P 500 symbols only.");
    }

    const rating = scorePortfolio({
      portfolioId,
      asOfDate,
      holdings,
      benchmarkPoints: parsed.data.benchmarkPoints,
      monthsOfHistory: parsed.data.monthsOfHistory
    });

    const snapshot = await savePortfolioSnapshot({
      userId,
      portfolioId,
      asOfDate,
      holdings: holdings.map((holding) => ({
        symbol: holding.ticker,
        shares: holding.shares
      })),
      rating
    });

    return jsonNoStore({ snapshot });
  } catch (error) {
    console.error("/api/portfolio POST error", error);
    return internalServerError("Failed to score portfolio.");
  }
}
