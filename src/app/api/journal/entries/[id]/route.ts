import type { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, okResponse } from "@/lib/api";
import { getApiAuthContext } from "@/lib/api/auth-context";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
import { getJournalEntryById, softDeleteJournalEntry, updateJournalEntry } from "@/lib/journal/store";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const UpdateSchema = z.object({
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

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Returns a single journal entry for the requesting user.
 */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-get",
    max: 180,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      throw new AuthError("Unauthenticated");
    }

    const { userId } = authContext;
    const { id } = await context.params;
    const entry = await getJournalEntryById(userId, id);
    if (!entry) {
      throw new NotFoundError("Journal entry");
    }

    log({
      level: "info",
      service: "api-journal-entry",
      message: "Journal entry loaded",
      userId,
      entryId: id,
      durationMs: Date.now() - startedAt
    });

    return okResponse({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "api-journal-entry-get" }, { "Cache-Control": "no-store" });
  }
}

/**
 * Updates a journal entry for the requesting user.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-patch",
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
    const { id } = await context.params;
    const parsed = UpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid update payload.");
    }

    const entry = await updateJournalEntry(userId, id, parsed.data);
    if (!entry) {
      throw new NotFoundError("Journal entry");
    }

    log({
      level: "info",
      service: "api-journal-entry",
      message: "Journal entry updated",
      userId,
      entryId: id,
      durationMs: Date.now() - startedAt
    });

    return okResponse({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "api-journal-entry-patch" }, { "Cache-Control": "no-store" });
  }
}

/**
 * Soft-deletes a journal entry for the requesting user.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-delete",
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
    const { id } = await context.params;
    const deleted = await softDeleteJournalEntry(userId, id);
    if (!deleted) {
      throw new NotFoundError("Journal entry");
    }

    log({
      level: "info",
      service: "api-journal-entry",
      message: "Journal entry deleted",
      userId,
      entryId: id,
      durationMs: Date.now() - startedAt
    });

    return okResponse({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "api-journal-entry-delete" }, { "Cache-Control": "no-store" });
  }
}
