import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "@vercel/postgres";

import type {
  JournalEntry,
  JournalEntryListFilters,
  JournalEntrySymbol,
  JournalEntryType,
  JournalListResult,
  JournalStatus,
  JournalUpsertInput
} from "@/lib/journal/types";

const hasPostgres = Boolean(process.env.POSTGRES_URL);
let initialized = false;

const ENTRY_TYPES: JournalEntryType[] = [
  "freeform",
  "thesis",
  "earnings_review",
  "postmortem",
  "watchlist_note"
];
const SENTIMENT_VALUES = ["bull", "bear", "neutral"] as const;
const HORIZON_VALUES = ["weeks", "months", "years"] as const;
const STATUS_VALUES: JournalStatus[] = ["draft", "final"];

interface LocalJournalStore {
  entries: JournalEntry[];
  revisions: Array<{
    id: string;
    userId: string;
    entryId: string;
    snapshot: JournalEntry;
    createdAt: string;
  }>;
}

interface DbEntryRow {
  id: string;
  user_id: string;
  title: string;
  content_md: string;
  content_plain: string;
  entry_type: JournalEntryType;
  sentiment: JournalEntry["sentiment"];
  conviction: number | null;
  time_horizon: JournalEntry["timeHorizon"];
  status: JournalStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  symbols: unknown;
  tags: unknown;
}

function resolveLocalPath(): string {
  const fallback = process.env.VERCEL ? "/tmp/journal-store.json" : "./data/journal.json";
  const configured = process.env.LOCAL_JOURNAL_DB_PATH ?? fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

const localStorePath = resolveLocalPath();

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_\- ]/g, "").replace(/\s+/g, "-").slice(0, 32);
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSymbols(input: JournalEntrySymbol[] | undefined): JournalEntrySymbol[] {
  if (!input || input.length === 0) return [];
  const out: JournalEntrySymbol[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    const symbol = normalizeSymbol(raw.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      primary: Boolean(raw.primary)
    });
    if (out.length >= 10) break;
  }

  if (out.length > 0 && !out.some((item) => item.primary)) {
    out[0].primary = true;
  }
  return out;
}

function normalizeTags(input: string[] | undefined): string[] {
  if (!input || input.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function parseIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function toSearchBlob(symbols: JournalEntrySymbol[], tags: string[]): string {
  return [...symbols.map((item) => item.symbol), ...tags].join(" ");
}

function coerceSymbols(raw: unknown): JournalEntrySymbol[] {
  if (!Array.isArray(raw)) return [];
  return normalizeSymbols(
    raw
      .map((item) => {
        if (typeof item !== "object" || item === null) return null;
        const row = item as { symbol?: unknown; primary?: unknown; is_primary?: unknown };
        if (typeof row.symbol !== "string") return null;
        return {
          symbol: row.symbol,
          primary: typeof row.primary === "boolean" ? row.primary : Boolean(row.is_primary)
        };
      })
      .filter((item): item is JournalEntrySymbol => item !== null)
  );
}

function coerceTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return normalizeTags(raw.filter((item): item is string => typeof item === "string"));
}

function mapDbRowToEntry(row: DbEntryRow): JournalEntry {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    contentMd: row.content_md,
    contentPlain: row.content_plain,
    entryType: row.entry_type,
    sentiment: row.sentiment ?? null,
    conviction: typeof row.conviction === "number" ? row.conviction : null,
    timeHorizon: row.time_horizon ?? null,
    status: row.status,
    symbols: coerceSymbols(row.symbols),
    tags: coerceTags(row.tags),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null
  };
}

function parseCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id) return null;
  const iso = parseIso(createdAt);
  if (!iso) return null;
  return { createdAt: iso, id };
}

function makeCursor(entry: JournalEntry): string {
  return `${entry.createdAt}|${entry.id}`;
}

function compareByCreatedDesc(a: JournalEntry, b: JournalEntry): number {
  const timeDelta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (timeDelta !== 0) return timeDelta;
  return b.id.localeCompare(a.id);
}

function computeRank(entry: JournalEntry, filters: JournalEntryListFilters): number {
  const q = filters.q?.trim().toLowerCase() ?? "";
  const symbol = normalizeSymbol(filters.symbol ?? "");
  const tag = normalizeTag(filters.tag ?? "");
  let score = 0;

  if (symbol && entry.symbols.some((item) => item.symbol === symbol)) score += 5;
  if (tag && entry.tags.includes(tag)) score += 1.5;
  if (q) {
    const titleLower = entry.title.toLowerCase();
    const plainLower = entry.contentPlain.toLowerCase();
    const symbolHit = entry.symbols.some((item) => item.symbol.toLowerCase() === q);
    if (symbolHit) score += 4;
    if (titleLower.includes(q)) score += 2;
    if (plainLower.includes(q)) score += 1;
  }

  const ageDays = Math.max(0, (Date.now() - Date.parse(entry.createdAt)) / (1000 * 60 * 60 * 24));
  score += 0.2 / (1 + ageDays / 30);
  return score;
}

function shouldUseRank(filters: JournalEntryListFilters): boolean {
  return Boolean((filters.q && filters.q.trim()) || (filters.symbol && filters.symbol.trim()) || (filters.tag && filters.tag.trim()));
}

async function ensurePostgres(): Promise<void> {
  if (!hasPostgres || initialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      content_plain TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('freeform','thesis','earnings_review','postmortem','watchlist_note')),
      sentiment TEXT CHECK (sentiment IS NULL OR sentiment IN ('bull','bear','neutral')),
      conviction SMALLINT CHECK (conviction IS NULL OR (conviction >= 1 AND conviction <= 5)),
      time_horizon TEXT CHECK (time_horizon IS NULL OR time_horizon IN ('weeks','months','years')),
      status TEXT NOT NULL CHECK (status IN ('draft','final')) DEFAULT 'draft',
      search_blob TEXT NOT NULL DEFAULT '',
      search_vector tsvector,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS journal_entries_user_created_idx ON journal_entries(user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS journal_entries_type_idx ON journal_entries(user_id, entry_type, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS journal_entries_status_idx ON journal_entries(user_id, status, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS journal_entries_search_idx ON journal_entries USING GIN(search_vector)`;

  await sql`
    CREATE TABLE IF NOT EXISTS journal_entry_symbols (
      entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(entry_id, symbol)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS journal_symbols_symbol_idx ON journal_entry_symbols(symbol, entry_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS journal_entry_tags (
      entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(entry_id, tag)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS journal_tags_tag_idx ON journal_entry_tags(tag, entry_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS journal_entry_revisions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS journal_revisions_entry_idx ON journal_entry_revisions(entry_id, created_at DESC)`;

  initialized = true;
}

async function readLocal(): Promise<LocalJournalStore> {
  try {
    const raw = await fs.readFile(localStorePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalJournalStore>;
    return {
      entries: Array.isArray(parsed.entries)
        ? parsed.entries
            .filter((item): item is JournalEntry => typeof item === "object" && item !== null)
            .map((item) => ({
              ...item,
              symbols: normalizeSymbols(item.symbols),
              tags: normalizeTags(item.tags),
              deletedAt: item.deletedAt ?? null
            }))
        : [],
      revisions: Array.isArray(parsed.revisions)
        ? parsed.revisions.filter(
            (item): item is LocalJournalStore["revisions"][number] =>
              typeof item === "object" && item !== null && typeof item.id === "string" && typeof item.entryId === "string"
          )
        : []
    };
  } catch {
    return { entries: [], revisions: [] };
  }
}

async function writeLocal(value: LocalJournalStore): Promise<void> {
  await fs.mkdir(path.dirname(localStorePath), { recursive: true });
  await fs.writeFile(localStorePath, JSON.stringify(value, null, 2), "utf8");
}

async function upsertRelations(entryId: string, symbols: JournalEntrySymbol[], tags: string[]): Promise<void> {
  await sql`DELETE FROM journal_entry_symbols WHERE entry_id = ${entryId}`;
  await sql`DELETE FROM journal_entry_tags WHERE entry_id = ${entryId}`;

  for (const symbol of symbols) {
    await sql`
      INSERT INTO journal_entry_symbols (entry_id, symbol, is_primary)
      VALUES (${entryId}, ${symbol.symbol}, ${symbol.primary})
      ON CONFLICT (entry_id, symbol) DO UPDATE SET is_primary = EXCLUDED.is_primary
    `;
  }
  for (const tag of tags) {
    await sql`
      INSERT INTO journal_entry_tags (entry_id, tag)
      VALUES (${entryId}, ${tag})
      ON CONFLICT (entry_id, tag) DO NOTHING
    `;
  }
}

async function getByIdFromPostgres(userId: string, entryId: string): Promise<JournalEntry | null> {
  await ensurePostgres();
  const { rows } = await sql<DbEntryRow>`
    SELECT
      e.id,
      e.user_id,
      e.title,
      e.content_md,
      e.content_plain,
      e.entry_type,
      e.sentiment,
      e.conviction,
      e.time_horizon,
      e.status,
      e.created_at,
      e.updated_at,
      e.deleted_at,
      COALESCE((
        SELECT json_agg(json_build_object('symbol', s.symbol, 'primary', s.is_primary) ORDER BY s.is_primary DESC, s.symbol ASC)
        FROM journal_entry_symbols s
        WHERE s.entry_id = e.id
      ), '[]'::json) AS symbols,
      COALESCE((
        SELECT json_agg(t.tag ORDER BY t.tag ASC)
        FROM journal_entry_tags t
        WHERE t.entry_id = e.id
      ), '[]'::json) AS tags
    FROM journal_entries e
    WHERE e.id = ${entryId}
      AND e.user_id = ${userId}
      AND e.deleted_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return mapDbRowToEntry(rows[0]);
}

function assertEntryType(value: string): JournalEntryType {
  if (!ENTRY_TYPES.includes(value as JournalEntryType)) {
    throw new Error(`Invalid entry type: ${value}`);
  }
  return value as JournalEntryType;
}

function assertStatus(value: string): JournalStatus {
  if (!STATUS_VALUES.includes(value as JournalStatus)) {
    throw new Error(`Invalid status: ${value}`);
  }
  return value as JournalStatus;
}

function sanitizeUpsertInput(input: JournalUpsertInput): {
  title: string;
  contentMd: string;
  contentPlain: string;
  entryType: JournalEntryType;
  sentiment: JournalEntry["sentiment"];
  conviction: number | null;
  timeHorizon: JournalEntry["timeHorizon"];
  status: JournalStatus;
  symbols: JournalEntrySymbol[];
  tags: string[];
  searchBlob: string;
  searchDocument: string;
} {
  const title = input.title.trim().slice(0, 220);
  const contentMd = input.contentMd.trim();
  const contentPlain = stripMarkdown(contentMd);
  const entryType = assertEntryType(input.entryType);
  const sentiment =
    input.sentiment && SENTIMENT_VALUES.includes(input.sentiment)
      ? input.sentiment
      : null;
  const conviction =
    typeof input.conviction === "number" && Number.isInteger(input.conviction) && input.conviction >= 1 && input.conviction <= 5
      ? input.conviction
      : null;
  const timeHorizon =
    input.timeHorizon && HORIZON_VALUES.includes(input.timeHorizon)
      ? input.timeHorizon
      : null;
  const status = assertStatus(input.status ?? "draft");
  const symbols = normalizeSymbols(input.symbols);
  const tags = normalizeTags(input.tags);
  const searchBlob = toSearchBlob(symbols, tags);
  const searchDocument = `${title} ${contentPlain} ${searchBlob}`.trim();

  return {
    title,
    contentMd,
    contentPlain,
    entryType,
    sentiment,
    conviction,
    timeHorizon,
    status,
    symbols,
    tags,
    searchBlob,
    searchDocument
  };
}

function buildInsights(entries: JournalEntry[], symbol: string | null): JournalListResult["insights"] {
  if (!symbol) {
    return {
      symbol: null,
      lastThesis: null,
      lastEarningsReview: null,
      openDrafts: []
    };
  }
  const upper = normalizeSymbol(symbol);
  const scoped = entries.filter((entry) => entry.symbols.some((item) => item.symbol === upper));
  return {
    symbol: upper,
    lastThesis: scoped.find((item) => item.entryType === "thesis") ?? null,
    lastEarningsReview: scoped.find((item) => item.entryType === "earnings_review") ?? null,
    openDrafts: scoped.filter((item) => item.status === "draft").slice(0, 5)
  };
}

export async function createJournalEntry(userId: string, input: JournalUpsertInput): Promise<JournalEntry> {
  const payload = sanitizeUpsertInput(input);
  const nowIso = new Date().toISOString();
  const entryId = crypto.randomUUID();

  if (hasPostgres) {
    await ensurePostgres();
    await sql`
      INSERT INTO journal_entries (
        id,
        user_id,
        title,
        content_md,
        content_plain,
        entry_type,
        sentiment,
        conviction,
        time_horizon,
        status,
        search_blob,
        search_vector,
        created_at,
        updated_at
      )
      VALUES (
        ${entryId},
        ${userId},
        ${payload.title},
        ${payload.contentMd},
        ${payload.contentPlain},
        ${payload.entryType},
        ${payload.sentiment},
        ${payload.conviction},
        ${payload.timeHorizon},
        ${payload.status},
        ${payload.searchBlob},
        to_tsvector('english', ${payload.searchDocument}),
        ${nowIso},
        ${nowIso}
      )
    `;
    await upsertRelations(entryId, payload.symbols, payload.tags);
    const created = await getByIdFromPostgres(userId, entryId);
    if (!created) throw new Error("Failed to load created journal entry.");
    return created;
  }

  const local = await readLocal();
  const entry: JournalEntry = {
    id: entryId,
    userId,
    title: payload.title,
    contentMd: payload.contentMd,
    contentPlain: payload.contentPlain,
    entryType: payload.entryType,
    sentiment: payload.sentiment,
    conviction: payload.conviction,
    timeHorizon: payload.timeHorizon,
    status: payload.status,
    symbols: payload.symbols,
    tags: payload.tags,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null
  };
  local.entries.unshift(entry);
  local.entries = local.entries.slice(0, 4000);
  await writeLocal(local);
  return entry;
}

export async function getJournalEntryById(userId: string, entryId: string): Promise<JournalEntry | null> {
  if (hasPostgres) {
    return getByIdFromPostgres(userId, entryId);
  }
  const local = await readLocal();
  return local.entries.find((item) => item.userId === userId && item.id === entryId && item.deletedAt === null) ?? null;
}

export async function updateJournalEntry(userId: string, entryId: string, input: JournalUpsertInput): Promise<JournalEntry | null> {
  const existing = await getJournalEntryById(userId, entryId);
  if (!existing) return null;

  const payload = sanitizeUpsertInput(input);
  const triesToEditLockedContent =
    existing.status === "final" &&
    payload.status !== "draft" &&
    (
      payload.title !== existing.title ||
      payload.contentMd !== existing.contentMd ||
      payload.entryType !== existing.entryType ||
      payload.sentiment !== existing.sentiment ||
      payload.conviction !== existing.conviction ||
      payload.timeHorizon !== existing.timeHorizon ||
      JSON.stringify(payload.symbols) !== JSON.stringify(existing.symbols) ||
      JSON.stringify(payload.tags) !== JSON.stringify(existing.tags)
    );

  if (triesToEditLockedContent) {
    throw new Error("Finalized entries are locked. Re-open before editing.");
  }

  const nowIso = new Date().toISOString();
  if (hasPostgres) {
    await ensurePostgres();
    await sql`
      UPDATE journal_entries
      SET
        title = ${payload.title},
        content_md = ${payload.contentMd},
        content_plain = ${payload.contentPlain},
        entry_type = ${payload.entryType},
        sentiment = ${payload.sentiment},
        conviction = ${payload.conviction},
        time_horizon = ${payload.timeHorizon},
        status = ${payload.status},
        search_blob = ${payload.searchBlob},
        search_vector = to_tsvector('english', ${payload.searchDocument}),
        updated_at = ${nowIso}
      WHERE id = ${entryId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
    `;
    await upsertRelations(entryId, payload.symbols, payload.tags);
    return getByIdFromPostgres(userId, entryId);
  }

  const local = await readLocal();
  const index = local.entries.findIndex((item) => item.userId === userId && item.id === entryId && item.deletedAt === null);
  if (index === -1) return null;
  local.entries[index] = {
    ...local.entries[index],
    title: payload.title,
    contentMd: payload.contentMd,
    contentPlain: payload.contentPlain,
    entryType: payload.entryType,
    sentiment: payload.sentiment,
    conviction: payload.conviction,
    timeHorizon: payload.timeHorizon,
    status: payload.status,
    symbols: payload.symbols,
    tags: payload.tags,
    updatedAt: nowIso
  };
  await writeLocal(local);
  return local.entries[index];
}

export async function softDeleteJournalEntry(userId: string, entryId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();

  if (hasPostgres) {
    await ensurePostgres();
    const result = await sql`
      UPDATE journal_entries
      SET deleted_at = ${nowIso}, updated_at = ${nowIso}
      WHERE id = ${entryId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
    `;
    return (result.rowCount ?? 0) > 0;
  }

  const local = await readLocal();
  const index = local.entries.findIndex((item) => item.userId === userId && item.id === entryId && item.deletedAt === null);
  if (index === -1) return false;
  local.entries[index] = {
    ...local.entries[index],
    deletedAt: nowIso,
    updatedAt: nowIso
  };
  await writeLocal(local);
  return true;
}

export async function finalizeJournalEntry(userId: string, entryId: string, reopen = false): Promise<JournalEntry | null> {
  const existing = await getJournalEntryById(userId, entryId);
  if (!existing) return null;
  const nowIso = new Date().toISOString();

  if (hasPostgres) {
    await ensurePostgres();
    if (reopen) {
      await sql`
        UPDATE journal_entries
        SET status = 'draft', updated_at = ${nowIso}
        WHERE id = ${entryId}
          AND user_id = ${userId}
          AND deleted_at IS NULL
      `;
      return getByIdFromPostgres(userId, entryId);
    }

    await sql`
      UPDATE journal_entries
      SET status = 'final', updated_at = ${nowIso}
      WHERE id = ${entryId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
    `;
    const latest = await getByIdFromPostgres(userId, entryId);
    if (!latest) return null;
    await sql`
      INSERT INTO journal_entry_revisions (id, entry_id, user_id, snapshot)
      VALUES (${crypto.randomUUID()}, ${entryId}, ${userId}, ${JSON.stringify(latest)}::jsonb)
    `;
    return latest;
  }

  const local = await readLocal();
  const index = local.entries.findIndex((item) => item.userId === userId && item.id === entryId && item.deletedAt === null);
  if (index === -1) return null;

  local.entries[index] = {
    ...local.entries[index],
    status: reopen ? "draft" : "final",
    updatedAt: nowIso
  };
  if (!reopen) {
    local.revisions.unshift({
      id: crypto.randomUUID(),
      userId,
      entryId,
      snapshot: local.entries[index],
      createdAt: nowIso
    });
    local.revisions = local.revisions.slice(0, 5000);
  }
  await writeLocal(local);
  return local.entries[index];
}

function applyFilters(entries: JournalEntry[], filters: JournalEntryListFilters): JournalEntry[] {
  const symbol = filters.symbol ? normalizeSymbol(filters.symbol) : null;
  const tag = filters.tag ? normalizeTag(filters.tag) : null;
  const q = filters.q?.trim().toLowerCase() ?? "";
  const fromIso = parseIso(filters.from ?? null);
  const toIso = parseIso(filters.to ?? null);

  return entries.filter((entry) => {
    if (entry.deletedAt) return false;
    if (filters.type && entry.entryType !== filters.type) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (symbol && !entry.symbols.some((item) => item.symbol === symbol)) return false;
    if (tag && !entry.tags.includes(tag)) return false;
    if (fromIso && Date.parse(entry.createdAt) < Date.parse(fromIso)) return false;
    if (toIso && Date.parse(entry.createdAt) > Date.parse(toIso)) return false;
    if (q) {
      const symbolHit = entry.symbols.some((item) => item.symbol.toLowerCase() === q);
      const tagHit = entry.tags.some((item) => item.toLowerCase().includes(q));
      const titleHit = entry.title.toLowerCase().includes(q);
      const plainHit = entry.contentPlain.toLowerCase().includes(q);
      if (!symbolHit && !tagHit && !titleHit && !plainHit) return false;
    }
    return true;
  });
}

function applyCursor(entries: JournalEntry[], cursor: string | null | undefined): JournalEntry[] {
  const parsed = parseCursor(cursor);
  if (!parsed) return entries;
  const cursorTime = Date.parse(parsed.createdAt);
  return entries.filter((entry) => {
    const entryTime = Date.parse(entry.createdAt);
    if (entryTime < cursorTime) return true;
    if (entryTime > cursorTime) return false;
    return entry.id < parsed.id;
  });
}

export async function listJournalEntries(userId: string, filters: JournalEntryListFilters): Promise<JournalListResult> {
  const limit = Math.max(1, Math.min(filters.limit ?? 20, 100));
  let all: JournalEntry[] = [];

  if (hasPostgres) {
    await ensurePostgres();
    const coarseLimit = Math.max(120, Math.min(limit * 8, 500));
    const symbol = filters.symbol ? normalizeSymbol(filters.symbol) : null;
    const tag = filters.tag ? normalizeTag(filters.tag) : null;
    const q = filters.q?.trim() ?? null;
    const fromIso = parseIso(filters.from ?? null);
    const toIso = parseIso(filters.to ?? null);
    const qLike = q ? `%${q}%` : "%%";

    const { rows } = await sql<DbEntryRow>`
      SELECT
        e.id,
        e.user_id,
        e.title,
        e.content_md,
        e.content_plain,
        e.entry_type,
        e.sentiment,
        e.conviction,
        e.time_horizon,
        e.status,
        e.created_at,
        e.updated_at,
        e.deleted_at,
        COALESCE((
          SELECT json_agg(json_build_object('symbol', s.symbol, 'primary', s.is_primary) ORDER BY s.is_primary DESC, s.symbol ASC)
          FROM journal_entry_symbols s
          WHERE s.entry_id = e.id
        ), '[]'::json) AS symbols,
        COALESCE((
          SELECT json_agg(t.tag ORDER BY t.tag ASC)
          FROM journal_entry_tags t
          WHERE t.entry_id = e.id
        ), '[]'::json) AS tags
      FROM journal_entries e
      WHERE e.user_id = ${userId}
        AND e.deleted_at IS NULL
        AND (${filters.type ?? null}::text IS NULL OR e.entry_type = ${filters.type ?? null})
        AND (${filters.status ?? null}::text IS NULL OR e.status = ${filters.status ?? null})
        AND (${fromIso}::timestamptz IS NULL OR e.created_at >= ${fromIso}::timestamptz)
        AND (${toIso}::timestamptz IS NULL OR e.created_at <= ${toIso}::timestamptz)
        AND (${symbol}::text IS NULL OR EXISTS (
          SELECT 1 FROM journal_entry_symbols sx
          WHERE sx.entry_id = e.id AND sx.symbol = ${symbol}
        ))
        AND (${tag}::text IS NULL OR EXISTS (
          SELECT 1 FROM journal_entry_tags tx
          WHERE tx.entry_id = e.id AND tx.tag = ${tag}
        ))
        AND (${q}::text IS NULL OR e.search_vector @@ plainto_tsquery('english', ${q}) OR e.title ILIKE ${qLike} OR e.content_plain ILIKE ${qLike})
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${coarseLimit}
    `;
    all = rows.map(mapDbRowToEntry);
  } else {
    const local = await readLocal();
    all = local.entries.filter((entry) => entry.userId === userId && entry.deletedAt === null);
  }

  let filtered = applyFilters(all, filters);
  if (shouldUseRank(filters)) {
    filtered = [...filtered].sort((a, b) => {
      const rankDelta = computeRank(b, filters) - computeRank(a, filters);
      if (Math.abs(rankDelta) > 0.0001) return rankDelta > 0 ? 1 : -1;
      return compareByCreatedDesc(a, b);
    });
  } else {
    filtered = [...filtered].sort(compareByCreatedDesc);
  }

  const cursorFiltered = applyCursor(filtered, filters.cursor);
  const page = cursorFiltered.slice(0, limit);
  const hasMore = cursorFiltered.length > limit;
  const nextCursor = hasMore && page.length > 0 ? makeCursor(page[page.length - 1]) : null;
  const insights = buildInsights(filtered, filters.symbol ?? null);

  return {
    items: page,
    nextCursor,
    insights
  };
}
