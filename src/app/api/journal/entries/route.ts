import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { createJournalEntry, listJournalEntries } from "@/lib/journal/store";
import { getJournalTemplate } from "@/lib/journal/templates";
import type { JournalEntryType, JournalStatus } from "@/lib/journal/types";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const entryTypeSchema = z.enum(["freeform", "thesis", "earnings_review", "postmortem", "watchlist_note"]);
const sentimentSchema = z.enum(["bull", "bear", "neutral"]);
const horizonSchema = z.enum(["weeks", "months", "years"]);
const statusSchema = z.enum(["draft", "final"]);

const createSchema = z.object({
  title: z.string().min(1).max(220),
  contentMd: z.string().max(120_000).optional(),
  entryType: entryTypeSchema,
  sentiment: sentimentSchema.nullable().optional(),
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  timeHorizon: horizonSchema.nullable().optional(),
  status: statusSchema.optional(),
  symbols: z
    .array(
      z.object({
        symbol: z.string().min(1).max(12),
        primary: z.boolean().optional()
      })
    )
    .max(10)
    .optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  useTemplate: z.boolean().optional()
});

function parseEntryType(value: string | null): JournalEntryType | null {
  if (!value) return null;
  if (value === "freeform" || value === "thesis" || value === "earnings_review" || value === "postmortem" || value === "watchlist_note") {
    return value;
  }
  return null;
}

function parseStatus(value: string | null): JournalStatus | null {
  if (!value) return null;
  if (value === "draft" || value === "final") return value;
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
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
      bucket: "api-journal-entries-get",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const { searchParams } = new URL(request.url);
    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const result = await listJournalEntries(userId, {
      symbol: searchParams.get("symbol"),
      tag: searchParams.get("tag"),
      type: parseEntryType(searchParams.get("type")),
      q: searchParams.get("q"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
      status: parseStatus(searchParams.get("status")),
      limit: Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20,
      cursor: searchParams.get("cursor")
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/journal/entries GET error", error);
    return NextResponse.json({ error: "Failed to load journal entries." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
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
      bucket: "api-journal-entries-post",
      max: 60,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const raw = await request.json();
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid journal payload." }, { status: 400 });
    }

    const contentMd =
      parsed.data.contentMd && parsed.data.contentMd.trim().length > 0
        ? parsed.data.contentMd
        : parsed.data.useTemplate
          ? getJournalTemplate(parsed.data.entryType)
          : "";

    const entry = await createJournalEntry(userId, {
      title: parsed.data.title,
      contentMd,
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

    return NextResponse.json({ entry }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/journal/entries POST error", error);
    return NextResponse.json({ error: "Failed to create journal entry." }, { status: 500 });
  }
}
