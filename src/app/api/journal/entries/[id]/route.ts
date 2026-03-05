import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { getJournalEntryById, softDeleteJournalEntry, updateJournalEntry } from "@/lib/journal/store";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const updateSchema = z.object({
  thesis: z.string().max(220).optional(),
  technicalSetup: z.string().max(10_000).optional(),
  fundamentalNote: z.string().max(10_000).optional(),
  marketContext: z.string().max(10_000).optional(),
  setupQuality: z.enum(["A", "B", "C"]).optional(),
  entryPrice: z.number().positive().nullable().optional(),
  targetPrice: z.number().positive().nullable().optional(),
  stopLoss: z.number().positive().nullable().optional(),
  positionSizePct: z.number().positive().max(100).nullable().optional(),
  followedPlan: z.boolean().nullable().optional(),
  executionNotes: z.string().max(10_000).optional(),
  exitPrice: z.number().positive().nullable().optional(),
  exitDate: z.string().nullable().optional(),
  whatWentRight: z.string().max(10_000).optional(),
  whatWentWrong: z.string().max(10_000).optional(),
  wouldDoAgain: z.boolean().nullable().optional(),
  tags: z.array(z.string().min(1).max(32)).max(30).optional()
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
      bucket: "api-journal-v1-entry-get",
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
      bucket: "api-journal-v1-entry-patch",
      max: 90,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const { id } = await context.params;
    const raw = await request.json();
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid update payload." }, { status: 400 });
    }

    const entry = await updateJournalEntry(userId, id, parsed.data);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }

    return NextResponse.json({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update entry.";
    console.error("/api/journal/entries/[id] PATCH error", error);
    return NextResponse.json({ error: message }, { status: 500 });
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
      bucket: "api-journal-v1-entry-delete",
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
