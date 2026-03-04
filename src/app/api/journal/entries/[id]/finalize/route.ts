import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { finalizeJournalEntry } from "@/lib/journal/store";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const payloadSchema = z.object({
  reopen: z.boolean().optional()
});

interface RouteContext {
  params: Promise<{ id: string }>;
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
      bucket: "api-journal-entry-finalize",
      max: 60,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    let reopen = false;
    try {
      const raw = await request.json();
      const parsed = payloadSchema.safeParse(raw);
      reopen = parsed.success ? Boolean(parsed.data.reopen) : false;
    } catch {
      reopen = false;
    }

    const { id } = await context.params;
    const entry = await finalizeJournalEntry(userId, id, reopen);
    if (!entry) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }

    return NextResponse.json({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/journal/entries/[id]/finalize POST error", error);
    return NextResponse.json({ error: "Failed to update entry status." }, { status: 500 });
  }
}
