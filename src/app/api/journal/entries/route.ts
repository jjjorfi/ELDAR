import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeStock } from "@/lib/analyze";
import { getApiAuthContext } from "@/lib/api/auth-context";
import { badRequest, jsonError, jsonNoStore, unauthorized } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { createJournalEntry, listJournalEntries } from "@/lib/journal/store";
import type { TradeStatus } from "@/lib/journal/types";

export const runtime = "nodejs";

const createSchema = z.object({
  ticker: z.string().min(1).max(12),
  thesis: z.string().min(1).max(220)
});

function parseStatus(raw: string | null): TradeStatus | null {
  if (raw === "PLANNING" || raw === "OPEN" || raw === "CLOSED") return raw;
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entries-get",
    max: 120,
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

    return jsonNoStore(result);
  } catch (error) {
    console.error("/api/journal/entries GET error", error);
    return jsonError("Failed to load journal entries.", 500, { noStore: false });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entries-post",
    max: 60,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId } = authContext;

    const raw = await request.json();
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest("Invalid payload.");
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

    return jsonNoStore({ entry }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create journal entry.";
    console.error("/api/journal/entries POST error", error);
    return jsonError(message, 500, { noStore: false });
  }
}
