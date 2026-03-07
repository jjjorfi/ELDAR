import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiAuthContext } from "@/lib/api/auth-context";
import {
  badRequest,
  jsonError,
  jsonNoStore,
  notFound,
  unauthorized
} from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { getJournalEntryById, softDeleteJournalEntry, updateJournalEntry } from "@/lib/journal/store";

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
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-get",
    max: 180,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId } = authContext;

    const { id } = await context.params;
    const entry = await getJournalEntryById(userId, id);
    if (!entry) {
      return notFound("Entry not found.");
    }

    return jsonNoStore({ entry });
  } catch (error) {
    console.error("/api/journal/entries/[id] GET error", error);
    return jsonError("Failed to load entry.", 500, { noStore: false });
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-patch",
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

    const { id } = await context.params;
    const raw = await request.json();
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest("Invalid update payload.");
    }

    const entry = await updateJournalEntry(userId, id, parsed.data);
    if (!entry) {
      return notFound("Entry not found.");
    }

    return jsonNoStore({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update entry.";
    console.error("/api/journal/entries/[id] PATCH error", error);
    return jsonError(message, 500, { noStore: false });
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-delete",
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

    const { id } = await context.params;
    const deleted = await softDeleteJournalEntry(userId, id);
    if (!deleted) {
      return notFound("Entry not found.");
    }

    return jsonNoStore({ ok: true });
  } catch (error) {
    console.error("/api/journal/entries/[id] DELETE error", error);
    return jsonError("Failed to delete entry.", 500, { noStore: false });
  }
}
