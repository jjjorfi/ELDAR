import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isTop100Sp500Symbol } from "@/lib/market/top100";
import { scorePortfolio } from "@/lib/scoring/portfolio-engine";
import type { PortfolioInputHolding } from "@/lib/scoring/portfolio-types";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
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
  try {
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) return error.response;
    throw error;
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const throttled = enforceRateLimit(request, {
      bucket: "api-portfolio-get",
      max: 90,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const { searchParams } = new URL(request.url);
    const portfolioId = (searchParams.get("portfolioId") ?? "default").trim() || "default";
    const snapshot = await getLatestPortfolioSnapshot(userId, portfolioId);

    return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/portfolio GET error", error);
    return NextResponse.json({ error: "Failed to load portfolio snapshot." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) return error.response;
    throw error;
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const throttled = enforceRateLimit(request, {
      bucket: "api-portfolio-post",
      max: 90,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const rawBody = await request.json();
    const parsed = payloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid portfolio payload." }, { status: 400 });
    }

    const portfolioId = (parsed.data.portfolioId ?? "default").trim() || "default";
    const asOfDate = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
    const holdings = normalizeHoldings(parsed.data.holdings);
    if (holdings.length === 0) {
      return NextResponse.json({ error: "Portfolio holdings are empty." }, { status: 400 });
    }

    const hasUnsupported = holdings.some((holding) => !isTop100Sp500Symbol(holding.ticker));
    if (hasUnsupported) {
      return NextResponse.json(
        { error: "Portfolio supports Top 100 S&P 500 symbols only." },
        { status: 400 }
      );
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

    return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/portfolio POST error", error);
    return NextResponse.json({ error: "Failed to score portfolio." }, { status: 500 });
  }
}
