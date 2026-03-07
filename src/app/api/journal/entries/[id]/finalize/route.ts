import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiAuthContext } from "@/lib/api/auth-context";
import { badRequest, jsonError, jsonNoStore, notFound, unauthorized } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { setJournalEntryStatus } from "@/lib/journal/store";
import type { TradeStatus } from "@/lib/journal/types";

export const runtime = "nodejs";

const payloadSchema = z.object({
  status: z.enum(["PLANNING", "OPEN", "CLOSED"]),
  reopen: z.boolean().optional()
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

function resolveStatus(input: z.infer<typeof payloadSchema>): TradeStatus {
  if (input.reopen) return "OPEN";
  return input.status;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-journal-v1-entry-status",
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
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest("Invalid payload.");
    }

    const status = resolveStatus(parsed.data);
    const entry = await setJournalEntryStatus(userId, (await context.params).id, status);
    if (!entry) {
      return notFound("Entry not found.");
    }

    return jsonNoStore({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update trade status.";
    console.error("/api/journal/entries/[id]/finalize POST error", error);
    return jsonError(message, 500, { noStore: false });
  }
}
