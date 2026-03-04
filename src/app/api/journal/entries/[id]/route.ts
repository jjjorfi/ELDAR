import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { getJournalEntryById, softDeleteJournalEntry, updateJournalEntry } from "@/lib/journal/store";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().min(1).max(220),
  contentMd: z.string().max(120_000),
  entryType: z.enum(["freeform", "thesis", "earnings_review", "postmortem", "watchlist_note"]),
  sentiment: z.enum(["bull", "bear", "neutral"]).nullable().optional(),
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  timeHorizon: z.enum(["weeks", "months", "years"]).nullable().optional(),
  status: z.enum(["draft", "final"]).optional(),
  symbols: z
    .array(
      z.object({
        symbol: z.string().min(1).max(12),
        primary: z.boolean().optional()
      })
    )
    .max(10)
    .optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional()
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
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
      bucket: "api-journal-entry-get",
      max: 180,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const { id } = await context.params;
    const entry = await getJournalEntryById(userId, id);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }

    return NextResponse.json({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/journal/entries/[id] GET error", error);
    return NextResponse.json({ error: "Failed to load entry." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
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
      bucket: "api-journal-entry-patch",
      max: 90,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const { id } = await context.params;
    const raw = await request.json();
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid update payload." }, { status: 400 });
    }

    const entry = await updateJournalEntry(userId, id, {
      title: parsed.data.title,
      contentMd: parsed.data.contentMd,
      entryType: parsed.data.entryType,
      sentiment: parsed.data.sentiment ?? null,
      conviction: parsed.data.conviction ?? null,
      timeHorizon: parsed.data.timeHorizon ?? null,
      status: parsed.data.status ?? "draft",
      symbols: (parsed.data.symbols ?? []).map((item) => ({
        symbol: item.symbol,
        primary: Boolean(item.primary)
      })),
      tags: parsed.data.tags ?? []
    });

    if (!entry) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }

    return NextResponse.json({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update entry.";
    if (message.includes("Finalized entries are locked")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("/api/journal/entries/[id] PATCH error", error);
    return NextResponse.json({ error: "Failed to update entry." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
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
      bucket: "api-journal-entry-delete",
      max: 60,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const { id } = await context.params;
    const deleted = await softDeleteJournalEntry(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/journal/entries/[id] DELETE error", error);
    return NextResponse.json({ error: "Failed to delete entry." }, { status: 500 });
  }
}
