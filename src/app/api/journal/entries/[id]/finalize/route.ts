import type { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, okResponse } from "@/lib/api";
import { getApiAuthContext } from "@/lib/api/auth-context";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
import { setJournalEntryStatus } from "@/lib/journal/store";
import { log } from "@/lib/logger";
import type { TradeStatus } from "@/lib/journal/types";

export const runtime = "nodejs";

const PayloadSchema = z.object({
  status: z.enum(["PLANNING", "OPEN", "CLOSED"]),
  reopen: z.boolean().optional()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function resolveStatus(input: z.infer<typeof PayloadSchema>): TradeStatus {
  if (input.reopen) return "OPEN";
  return input.status;
}

/**
 * Updates the status of a journal entry.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-status",
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
    const parsed = PayloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid payload.");
    }

    const status = resolveStatus(parsed.data);
    const entry = await setJournalEntryStatus(userId, (await context.params).id, status);
    if (!entry) {
      throw new NotFoundError("Journal entry");
    }

    log({
      level: "info",
      service: "api-journal-entry",
      message: "Journal entry status updated",
      userId,
      entryId: entry.id,
      status,
      durationMs: Date.now() - startedAt
    });

    return okResponse({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "api-journal-entry-finalize" }, { "Cache-Control": "no-store" });
  }
}
