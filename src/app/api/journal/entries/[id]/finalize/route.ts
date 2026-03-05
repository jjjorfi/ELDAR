import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { setJournalEntryStatus } from "@/lib/journal/store";
import type { TradeStatus } from "@/lib/journal/types";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

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
      bucket: "api-journal-v1-entry-status",
      max: 60,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const raw = await request.json();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const status = resolveStatus(parsed.data);
    const entry = await setJournalEntryStatus(userId, (await context.params).id, status);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }

    return NextResponse.json({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update trade status.";
    console.error("/api/journal/entries/[id]/finalize POST error", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
