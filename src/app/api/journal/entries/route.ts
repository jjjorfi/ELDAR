import type { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, okResponse } from "@/lib/api";
import { getApiAuthContext } from "@/lib/api/auth-context";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError, ValidationError } from "@/lib/errors";
import { analyzeStock } from "@/lib/analyze";
import { createJournalEntry, listJournalEntries } from "@/lib/journal/store";
import { log } from "@/lib/logger";
import type { TradeStatus } from "@/lib/journal/types";

export const runtime = "nodejs";

const CreateSchema = z.object({
  ticker: z.string().min(1).max(12),
  thesis: z.string().min(1).max(220)
});

function parseStatus(raw: string | null): TradeStatus | null {
  if (raw === "PLANNING" || raw === "OPEN" || raw === "CLOSED") return raw;
  return null;
}

/**
 * Lists the requesting user's journal entries.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entries-get",
    max: 120,
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
    const status = parseStatus(searchParams.get("status"));
    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "200", 10);

    const result = await listJournalEntries(userId, {
      status,
      ticker: searchParams.get("ticker") ?? searchParams.get("symbol"),
      q: searchParams.get("q"),
      sort: (searchParams.get("sort") as "createdAt" | "returnPct" | "setupQuality" | null) ?? undefined,
      direction: (searchParams.get("direction") as "asc" | "desc" | null) ?? undefined,
      limit: Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200
    });

    log({
      level: "info",
      service: "api-journal",
      message: "Journal entries loaded",
      userId,
      entryCount: result.items.length,
      durationMs: Date.now() - startedAt
    });

    return okResponse(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "api-journal-entries-get" }, { "Cache-Control": "no-store" });
  }
}

/**
 * Creates a journal entry with a captured Eldar analysis snapshot.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entries-post",
    max: 60,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      throw new AuthError("Unauthenticated");
    }

    const { userId } = authContext;
    const parsed = CreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid journal payload.");
    }

    const analysis = await analyzeStock(parsed.data.ticker);
    const snapshot = {
      capturedAt: new Date().toISOString(),
      modelVersion: analysis.modelVersion,
      score: analysis.score,
      rating: analysis.rating,
      topDrivers: analysis.factors
        .filter((factor) => factor.hasData)
        .sort((left, right) => Math.abs(right.points) - Math.abs(left.points))
        .map((factor) => factor.factor)
        .slice(0, 3)
    };

    const entry = await createJournalEntry(userId, {
      ticker: parsed.data.ticker,
      thesis: parsed.data.thesis,
      eldarSnapshot: snapshot
    });

    log({
      level: "info",
      service: "api-journal",
      message: "Journal entry created",
      userId,
      ticker: parsed.data.ticker.toUpperCase(),
      durationMs: Date.now() - startedAt
    });

    return okResponse({ entry }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "api-journal-entries-post" }, { "Cache-Control": "no-store" });
  }
}
