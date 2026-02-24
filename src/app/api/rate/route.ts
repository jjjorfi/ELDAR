import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { analyzeStock } from "@/lib/analyze";
import { fetchEodhdQuoteSnapshot } from "@/lib/market/eodhd";
import { fetchFinnhubQuoteSnapshot } from "@/lib/market/finnhub";
import { fetchFmpQuoteSnapshot } from "@/lib/market/fmp";
import { mergePriceObservations } from "@/lib/market/price-merge";
import { fetchYahooQuoteSnapshot } from "@/lib/market/yahoo";
import { isTop100Sp500Symbol } from "@/lib/market/top100";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getCachedAnalysis, saveAnalysis } from "@/lib/storage";
import type { PersistedAnalysis } from "@/lib/types";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const payloadSchema = z.object({
  symbol: z.string().min(1).max(12)
});

const FAST_PRICE_REFRESH_TIMEOUT_MS = 900;
const CACHE_FRESH_MS = 30_000;

function isCachedAnalysisFresh(analysis: PersistedAnalysis): boolean {
  const createdAtMs = Date.parse(analysis.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return Date.now() - createdAtMs < CACHE_FRESH_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

async function refreshLatestPriceWithFallback(analysis: PersistedAnalysis): Promise<PersistedAnalysis> {
  const [eodhdQuote, yahooQuote, finnhubQuote, fmpQuote] = await Promise.all([
    withTimeout(fetchEodhdQuoteSnapshot(analysis.symbol), FAST_PRICE_REFRESH_TIMEOUT_MS),
    withTimeout(fetchYahooQuoteSnapshot(analysis.symbol), FAST_PRICE_REFRESH_TIMEOUT_MS),
    withTimeout(fetchFinnhubQuoteSnapshot(analysis.symbol), FAST_PRICE_REFRESH_TIMEOUT_MS),
    withTimeout(fetchFmpQuoteSnapshot(analysis.symbol), FAST_PRICE_REFRESH_TIMEOUT_MS)
  ]);

  const merged = mergePriceObservations({
    symbol: analysis.symbol,
    lastKnownGoodPrice: analysis.currentPrice,
    observations: [
      { source: "EODHD", price: eodhdQuote?.price ?? null, timestampMs: eodhdQuote?.asOfMs ?? null, baseWeight: 1.0 },
      { source: "YAHOO", price: yahooQuote?.price ?? null, timestampMs: yahooQuote?.asOfMs ?? null, baseWeight: 0.9 },
      { source: "FINNHUB", price: finnhubQuote?.price ?? null, timestampMs: finnhubQuote?.asOfMs ?? null, baseWeight: 0.8 },
      { source: "FMP", price: fmpQuote?.price ?? null, timestampMs: fmpQuote?.asOfMs ?? null, baseWeight: 0.7 }
    ]
  });

  for (const warning of merged.warnings) {
    console.warn(`[${warning.type}] ${warning.message}`);
  }

  const latestPrice = merged.value;

  if (latestPrice === null || latestPrice <= 0) {
    return analysis;
  }

  if (Math.abs(latestPrice - analysis.currentPrice) < 0.0001) {
    return analysis;
  }

  return {
    ...analysis,
    currentPrice: latestPrice
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const { userId } = await auth();

    const throttled = enforceRateLimit(request, {
      bucket: "api-rate",
      max: 60,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const rawBody = await request.json();
    const parsed = payloadSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid payload. Expected: { symbol: string }"
        },
        { status: 400 }
      );
    }

    const symbol = sanitizeSymbol(parsed.data.symbol);

    if (!symbol) {
      return NextResponse.json({ error: "Ticker symbol is invalid." }, { status: 400 });
    }

    if (!isTop100Sp500Symbol(symbol)) {
      return NextResponse.json(
        { error: "ELDAR currently supports Top 100 S&P 500 symbols only." },
        { status: 400 }
      );
    }

    const cached = await getCachedAnalysis(symbol, undefined, userId ?? null);

    if (cached) {
      if (isCachedAnalysisFresh(cached)) {
        return NextResponse.json({ analysis: cached, cached: true });
      }
      const analysisWithLatestPrice = await refreshLatestPriceWithFallback(cached);
      return NextResponse.json({ analysis: analysisWithLatestPrice, cached: true });
    }

    const analysis = await analyzeStock(symbol);
    const persisted = await saveAnalysis(analysis, userId ?? null);
    return NextResponse.json({ analysis: persisted, cached: false }, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("/api/rate error", error);

    return NextResponse.json(
      {
        error: "Failed to generate rating. Please try again."
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
