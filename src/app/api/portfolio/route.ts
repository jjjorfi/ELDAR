import { z } from "zod";

import { errorResponse, okResponse } from "@/lib/api";
import { getApiAuthContext } from "@/lib/api/auth-context";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import { resolveSp500DirectorySymbol } from "@/lib/market/universe/sp500-universe";
import { scorePortfolio } from "@/lib/scoring/portfolio/engine";
import type { PortfolioInputHolding } from "@/lib/scoring/portfolio/types";
import { getLatestPortfolioSnapshot, savePortfolioSnapshot } from "@/lib/storage/index";

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

export async function GET(request: Request) {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-portfolio-get",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      throw new AuthError("Unauthenticated");
    }
    const { userId } = authContext;

    const { searchParams } = new URL(request.url);
    const portfolioId = (searchParams.get("portfolioId") ?? "default").trim() || "default";
    const snapshot = await getLatestPortfolioSnapshot(userId, portfolioId);

    log({
      level: "info",
      service: "api-portfolio",
      message: "Portfolio snapshot loaded",
      userId,
      portfolioId,
      durationMs: Date.now() - startedAt
    });

    return okResponse(
      { snapshot },
      {
        headers: withApiPerfHeaders(
          { "Cache-Control": "no-store" },
          {
            startedAt,
            cache: "database"
          }
        )
      }
    );
  } catch (error) {
    return errorResponse(
      error,
      { route: "api-portfolio-get" },
      withApiPerfHeaders(
        { "Cache-Control": "no-store" },
        {
          startedAt,
          cache: "error"
        }
      )
    );
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-portfolio-post",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      throw new AuthError("Unauthenticated");
    }
    const { userId } = authContext;

    const rawBody = await request.json();
    const parsed = payloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new ValidationError("Invalid portfolio payload.");
    }

    const portfolioId = (parsed.data.portfolioId ?? "default").trim() || "default";
    const asOfDate = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
    const holdings = normalizeHoldings(parsed.data.holdings);
    if (holdings.length === 0) {
      throw new ValidationError("Portfolio holdings are empty.");
    }

    const sp500Directory = await fetchSP500Directory();
    const canonicalHoldings = holdings.map((holding) => ({
      ...holding,
      ticker: resolveSp500DirectorySymbol(holding.ticker, sp500Directory)
    }));
    const hasUnsupported = canonicalHoldings.some((holding) => !holding.ticker);
    if (hasUnsupported) throw new ValidationError("Portfolio supports S&P 500 symbols only.");
    const supportedHoldings = canonicalHoldings as PortfolioInputHolding[];

    const rating = scorePortfolio({
      portfolioId,
      asOfDate,
      holdings: supportedHoldings,
      benchmarkPoints: parsed.data.benchmarkPoints,
      monthsOfHistory: parsed.data.monthsOfHistory
    });

    const snapshot = await savePortfolioSnapshot({
      userId,
      portfolioId,
      asOfDate,
      holdings: supportedHoldings.map((holding) => ({
        symbol: holding.ticker,
        shares: holding.shares
      })),
      rating
    });

    log({
      level: "info",
      service: "api-portfolio",
      message: "Portfolio snapshot saved",
      userId,
      portfolioId,
      holdingCount: supportedHoldings.length,
      durationMs: Date.now() - startedAt
    });

    return okResponse(
      { snapshot },
      {
        headers: withApiPerfHeaders(
          { "Cache-Control": "no-store" },
          {
            startedAt,
            cache: "computed"
          }
        )
      }
    );
  } catch (error) {
    return errorResponse(
      error,
      { route: "api-portfolio-post" },
      withApiPerfHeaders(
        { "Cache-Control": "no-store" },
        {
          startedAt,
          cache: "error"
        }
      )
    );
  }
}
