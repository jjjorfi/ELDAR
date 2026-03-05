import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "@vercel/postgres";

import type {
  JournalCreateInput,
  JournalEntry,
  JournalListFilters,
  JournalListResult,
  JournalReviewStats,
  JournalUpdateInput,
  SetupQuality,
  TradeStatus
} from "@/lib/journal/types";

const hasPostgres = Boolean(process.env.POSTGRES_URL);
let initialized = false;

interface LocalJournalStore {
  entries: JournalEntry[];
}

interface DbJournalRow {
  id: string;
  user_id: string;
  status: TradeStatus;
  ticker: string;
  thesis: string;
  eldar_snapshot: unknown;
  technical_setup: string;
  fundamental_note: string;
  market_context: string;
  setup_quality: SetupQuality;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  position_size_pct: number | null;
  followed_plan: boolean | null;
  execution_notes: string;
  exit_price: number | null;
  exit_date: string | null;
  what_went_right: string;
  what_went_wrong: string;
  would_do_again: boolean | null;
  tags: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function resolveLocalPath(): string {
  const fallback = process.env.VERCEL ? "/tmp/journal-v1-store.json" : "./data/journal-v1.json";
  const configured = process.env.LOCAL_JOURNAL_DB_PATH ?? fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

const localStorePath = resolveLocalPath();

function toNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}

function computeOutcomeMetrics(entry: JournalEntry): Pick<JournalEntry, "returnPct" | "daysHeld"> {
  if (entry.entryPrice === null || entry.entryPrice <= 0 || entry.exitPrice === null) {
    return { returnPct: null, daysHeld: null };
  }

  const returnPct = ((entry.exitPrice - entry.entryPrice) / entry.entryPrice) * 100;
  let daysHeld: number | null = null;

  if (entry.exitDate) {
    const start = Date.parse(entry.createdAt);
    const end = Date.parse(entry.exitDate);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      daysHeld = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
    }
  }

  return {
    returnPct: Math.round(returnPct * 100) / 100,
    daysHeld
  };
}

function hydrateEntry(raw: JournalEntry): JournalEntry {
  const withMetrics = computeOutcomeMetrics(raw);
  return {
    ...raw,
    returnPct: withMetrics.returnPct,
    daysHeld: withMetrics.daysHeld
  };
}

function reviewFromClosed(entries: JournalEntry[]): JournalReviewStats {
  const closed = entries.filter((entry) => entry.status === "CLOSED" && typeof entry.returnPct === "number");

  const winners = closed.filter((entry) => (entry.returnPct ?? 0) > 0);
  const losers = closed.filter((entry) => (entry.returnPct ?? 0) < 0);

  const avg = (values: number[]): number | null =>
    values.length > 0 ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null;

  const winRate = closed.length > 0 ? Math.round((winners.length / closed.length) * 10000) / 100 : null;
  const avgWinner = avg(winners.map((entry) => entry.returnPct ?? 0));
  const avgLoser = avg(losers.map((entry) => entry.returnPct ?? 0));

  const setupGroups: Record<SetupQuality, JournalEntry[]> = { A: [], B: [], C: [] };
  for (const entry of closed) {
    setupGroups[entry.setupQuality].push(entry);
  }

  const setupWinRate = (quality: SetupQuality): number | null => {
    const items = setupGroups[quality];
    if (items.length === 0) return null;
    const wins = items.filter((entry) => (entry.returnPct ?? 0) > 0).length;
    return Math.round((wins / items.length) * 10000) / 100;
  };

  const setupScores = (["A", "B", "C"] as SetupQuality[])
    .map((quality) => ({ quality, winRate: setupWinRate(quality) }))
    .filter((item) => item.winRate !== null) as Array<{ quality: SetupQuality; winRate: number }>;

  const bestSetup = setupScores.length > 0
    ? setupScores.sort((left, right) => right.winRate - left.winRate)[0]
    : null;

  const tagCounts = new Map<string, number>();
  const tagReturns = new Map<string, number[]>();
  for (const entry of closed) {
    for (const tag of entry.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      if (typeof entry.returnPct === "number") {
        const list = tagReturns.get(tag) ?? [];
        list.push(entry.returnPct);
        tagReturns.set(tag, list);
      }
    }
  }

  const mostUsedTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  const bestTags = [...tagReturns.entries()]
    .map(([tag, values]) => ({
      tag,
      avgReturn: avg(values),
      count: values.length
    }))
    .sort((left, right) => {
      const leftValue = left.avgReturn ?? -Infinity;
      const rightValue = right.avgReturn ?? -Infinity;
      return rightValue - leftValue;
    })
    .slice(0, 6);

  const worstHabit = [...tagCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([tag, count]) => ({ tag, count }))[0] ?? null;

  const avgEldarOnWinners = avg(winners.map((entry) => entry.eldarSnapshot.score));
  const avgEldarOnLosers = avg(losers.map((entry) => entry.eldarSnapshot.score));

  return {
    winRate,
    avgWinner,
    avgLoser,
    bestSetup,
    worstHabit,
    avgEldarOnWinners,
    avgEldarOnLosers,
    mostUsedTags,
    bestTags
  };
}

async function readLocalStore(): Promise<LocalJournalStore> {
  try {
    const raw = await fs.readFile(localStorePath, "utf8");
    const parsed = JSON.parse(raw) as LocalJournalStore;
    return {
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.map((item) => hydrateEntry(item)).filter((item) => !item.deletedAt)
        : []
    };
  } catch {
    return { entries: [] };
  }
}

async function writeLocalStore(store: LocalJournalStore): Promise<void> {
  await fs.mkdir(path.dirname(localStorePath), { recursive: true });
  await fs.writeFile(localStorePath, JSON.stringify(store, null, 2), "utf8");
}

async function ensureDbReady(): Promise<void> {
  if (initialized || !hasPostgres) return;

  await sql`
    CREATE TABLE IF NOT EXISTS journal_trade_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      ticker TEXT NOT NULL,
      thesis TEXT NOT NULL,
      eldar_snapshot JSONB NOT NULL,
      technical_setup TEXT NOT NULL,
      fundamental_note TEXT NOT NULL,
      market_context TEXT NOT NULL,
      setup_quality TEXT NOT NULL,
      entry_price DOUBLE PRECISION,
      target_price DOUBLE PRECISION,
      stop_loss DOUBLE PRECISION,
      position_size_pct DOUBLE PRECISION,
      followed_plan BOOLEAN,
      execution_notes TEXT NOT NULL,
      exit_price DOUBLE PRECISION,
      exit_date TEXT,
      what_went_right TEXT NOT NULL,
      what_went_wrong TEXT NOT NULL,
      would_do_again BOOLEAN,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_journal_trade_entries_user_created ON journal_trade_entries (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_journal_trade_entries_user_status ON journal_trade_entries (user_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_journal_trade_entries_user_ticker ON journal_trade_entries (user_id, ticker)`;

  initialized = true;
}

function mapDbRow(row: DbJournalRow): JournalEntry {
  const entry: JournalEntry = {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    status: row.status,
    ticker: row.ticker,
    thesis: row.thesis,
    eldarSnapshot: row.eldar_snapshot as JournalEntry["eldarSnapshot"],
    technicalSetup: row.technical_setup,
    fundamentalNote: row.fundamental_note,
    marketContext: row.market_context,
    setupQuality: row.setup_quality,
    entryPrice: row.entry_price,
    targetPrice: row.target_price,
    stopLoss: row.stop_loss,
    positionSizePct: row.position_size_pct,
    followedPlan: row.followed_plan,
    executionNotes: row.execution_notes,
    exitPrice: row.exit_price,
    exitDate: row.exit_date,
    returnPct: null,
    daysHeld: null,
    whatWentRight: row.what_went_right,
    whatWentWrong: row.what_went_wrong,
    wouldDoAgain: row.would_do_again,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    deletedAt: row.deleted_at
  };
  return hydrateEntry(entry);
}

function buildEntry(input: JournalCreateInput): JournalEntry {
  const now = new Date().toISOString();
  const base: JournalEntry = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "PLANNING",
    ticker: normalizeTicker(input.ticker),
    thesis: input.thesis.trim().slice(0, 220),
    eldarSnapshot: {
      ...input.eldarSnapshot,
      topDrivers: input.eldarSnapshot.topDrivers.slice(0, 3)
    },
    technicalSetup: "",
    fundamentalNote: "",
    marketContext: "",
    setupQuality: "B",
    entryPrice: null,
    targetPrice: null,
    stopLoss: null,
    positionSizePct: null,
    followedPlan: null,
    executionNotes: "",
    exitPrice: null,
    exitDate: null,
    returnPct: null,
    daysHeld: null,
    whatWentRight: "",
    whatWentWrong: "",
    wouldDoAgain: null,
    tags: [],
    deletedAt: null
  };
  return hydrateEntry(base);
}

function applyFilters(entries: JournalEntry[], filters: JournalListFilters = {}): JournalEntry[] {
  const ticker = filters.ticker ? normalizeTicker(filters.ticker) : null;
  const q = filters.q?.trim().toLowerCase() ?? "";

  let filtered = entries.filter((entry) => !entry.deletedAt);

  if (filters.status) {
    filtered = filtered.filter((entry) => entry.status === filters.status);
  }
  if (ticker) {
    filtered = filtered.filter((entry) => entry.ticker === ticker);
  }
  if (q) {
    filtered = filtered.filter((entry) =>
      [
        entry.ticker,
        entry.thesis,
        entry.technicalSetup,
        entry.fundamentalNote,
        entry.marketContext,
        entry.executionNotes,
        entry.whatWentRight,
        entry.whatWentWrong,
        ...entry.tags
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  const sort = filters.sort ?? "createdAt";
  const direction = filters.direction ?? "desc";
  const sign = direction === "asc" ? 1 : -1;

  filtered.sort((left, right) => {
    if (sort === "returnPct") {
      const leftValue = left.returnPct ?? Number.NEGATIVE_INFINITY;
      const rightValue = right.returnPct ?? Number.NEGATIVE_INFINITY;
      return (leftValue - rightValue) * sign;
    }
    if (sort === "setupQuality") {
      const rank: Record<SetupQuality, number> = { A: 3, B: 2, C: 1 };
      return (rank[left.setupQuality] - rank[right.setupQuality]) * sign;
    }
    return (Date.parse(left.createdAt) - Date.parse(right.createdAt)) * sign;
  });

  const limit = Math.max(1, Math.min(filters.limit ?? 200, 500));
  return filtered.slice(0, limit);
}

function assertOpenReady(entry: JournalEntry): void {
  if (entry.entryPrice === null || entry.targetPrice === null || entry.stopLoss === null || entry.positionSizePct === null) {
    throw new Error("Plan is incomplete. Entry, target, stop, and size are required before opening.");
  }
  if (entry.entryPrice <= 0 || entry.targetPrice <= 0 || entry.stopLoss <= 0 || entry.positionSizePct <= 0) {
    throw new Error("Plan values must be positive numbers.");
  }
}

function patchEntry(current: JournalEntry, patch: JournalUpdateInput): JournalEntry {
  const isClosed = current.status === "CLOSED";
  const next: JournalEntry = { ...current };

  if (!isClosed) {
    if (typeof patch.thesis === "string") next.thesis = patch.thesis.trim().slice(0, 220);
    if (typeof patch.technicalSetup === "string") next.technicalSetup = patch.technicalSetup;
    if (typeof patch.fundamentalNote === "string") next.fundamentalNote = patch.fundamentalNote;
    if (typeof patch.marketContext === "string") next.marketContext = patch.marketContext;
    if (patch.setupQuality === "A" || patch.setupQuality === "B" || patch.setupQuality === "C") next.setupQuality = patch.setupQuality;
    if ("entryPrice" in patch) next.entryPrice = toNumberOrNull(patch.entryPrice);
    if ("targetPrice" in patch) next.targetPrice = toNumberOrNull(patch.targetPrice);
    if ("stopLoss" in patch) next.stopLoss = toNumberOrNull(patch.stopLoss);
    if ("positionSizePct" in patch) next.positionSizePct = toNumberOrNull(patch.positionSizePct);
  }

  if (isClosed) {
    if ("followedPlan" in patch) next.followedPlan = patch.followedPlan ?? null;
    if (typeof patch.executionNotes === "string") next.executionNotes = patch.executionNotes;
    if ("exitPrice" in patch) next.exitPrice = toNumberOrNull(patch.exitPrice);
    if ("exitDate" in patch) next.exitDate = patch.exitDate ?? null;
    if (typeof patch.whatWentRight === "string") next.whatWentRight = patch.whatWentRight;
    if (typeof patch.whatWentWrong === "string") next.whatWentWrong = patch.whatWentWrong;
    if ("wouldDoAgain" in patch) next.wouldDoAgain = patch.wouldDoAgain ?? null;
    if (Array.isArray(patch.tags)) next.tags = normalizeTags(patch.tags);
  }

  next.updatedAt = new Date().toISOString();
  return hydrateEntry(next);
}

export async function createJournalEntry(userId: string, input: JournalCreateInput): Promise<JournalEntry> {
  const entry = buildEntry(input);

  if (!hasPostgres) {
    const store = await readLocalStore();
    store.entries.unshift(entry);
    await writeLocalStore(store);
    return entry;
  }

  await ensureDbReady();
  await sql`
    INSERT INTO journal_trade_entries (
      id, user_id, status, ticker, thesis, eldar_snapshot,
      technical_setup, fundamental_note, market_context, setup_quality,
      entry_price, target_price, stop_loss, position_size_pct,
      followed_plan, execution_notes, exit_price, exit_date,
      what_went_right, what_went_wrong, would_do_again, tags,
      created_at, updated_at, deleted_at
    ) VALUES (
      ${entry.id}, ${userId}, ${entry.status}, ${entry.ticker}, ${entry.thesis}, ${JSON.stringify(entry.eldarSnapshot)}::jsonb,
      ${entry.technicalSetup}, ${entry.fundamentalNote}, ${entry.marketContext}, ${entry.setupQuality},
      ${entry.entryPrice}, ${entry.targetPrice}, ${entry.stopLoss}, ${entry.positionSizePct},
      ${entry.followedPlan}, ${entry.executionNotes}, ${entry.exitPrice}, ${entry.exitDate},
      ${entry.whatWentRight}, ${entry.whatWentWrong}, ${entry.wouldDoAgain}, ${JSON.stringify(entry.tags)}::jsonb,
      ${entry.createdAt}::timestamptz, ${entry.updatedAt}::timestamptz, NULL
    )
  `;
  return entry;
}

export async function listJournalEntries(userId: string, filters: JournalListFilters = {}): Promise<JournalListResult> {
  let entries: JournalEntry[] = [];

  if (!hasPostgres) {
    const store = await readLocalStore();
    entries = store.entries.filter((entry) => entry.deletedAt === null);
  } else {
    await ensureDbReady();
    const { rows } = await sql<DbJournalRow>`
      SELECT
        id, user_id, status, ticker, thesis, eldar_snapshot, technical_setup, fundamental_note,
        market_context, setup_quality, entry_price, target_price, stop_loss, position_size_pct,
        followed_plan, execution_notes, exit_price, exit_date, what_went_right, what_went_wrong,
        would_do_again, tags, created_at, updated_at, deleted_at
      FROM journal_trade_entries
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    entries = rows.map(mapDbRow);
  }

  const filtered = applyFilters(entries, filters);
  return {
    items: filtered,
    review: reviewFromClosed(entries)
  };
}

export async function getJournalEntryById(userId: string, id: string): Promise<JournalEntry | null> {
  if (!hasPostgres) {
    const store = await readLocalStore();
    return store.entries.find((entry) => entry.id === id && entry.deletedAt === null) ?? null;
  }

  await ensureDbReady();
  const { rows } = await sql<DbJournalRow>`
    SELECT
      id, user_id, status, ticker, thesis, eldar_snapshot, technical_setup, fundamental_note,
      market_context, setup_quality, entry_price, target_price, stop_loss, position_size_pct,
      followed_plan, execution_notes, exit_price, exit_date, what_went_right, what_went_wrong,
      would_do_again, tags, created_at, updated_at, deleted_at
    FROM journal_trade_entries
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return mapDbRow(rows[0]);
}

export async function updateJournalEntry(userId: string, id: string, patch: JournalUpdateInput): Promise<JournalEntry | null> {
  const current = await getJournalEntryById(userId, id);
  if (!current) return null;

  const updated = patchEntry(current, patch);

  if (!hasPostgres) {
    const store = await readLocalStore();
    store.entries = store.entries.map((entry) => (entry.id === id ? updated : entry));
    await writeLocalStore(store);
    return updated;
  }

  await ensureDbReady();
  await sql`
    UPDATE journal_trade_entries
    SET
      status = ${updated.status},
      ticker = ${updated.ticker},
      thesis = ${updated.thesis},
      technical_setup = ${updated.technicalSetup},
      fundamental_note = ${updated.fundamentalNote},
      market_context = ${updated.marketContext},
      setup_quality = ${updated.setupQuality},
      entry_price = ${updated.entryPrice},
      target_price = ${updated.targetPrice},
      stop_loss = ${updated.stopLoss},
      position_size_pct = ${updated.positionSizePct},
      followed_plan = ${updated.followedPlan},
      execution_notes = ${updated.executionNotes},
      exit_price = ${updated.exitPrice},
      exit_date = ${updated.exitDate},
      what_went_right = ${updated.whatWentRight},
      what_went_wrong = ${updated.whatWentWrong},
      would_do_again = ${updated.wouldDoAgain},
      tags = ${JSON.stringify(updated.tags)}::jsonb,
      updated_at = ${updated.updatedAt}::timestamptz
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `;
  return updated;
}

export async function setJournalEntryStatus(userId: string, id: string, status: TradeStatus): Promise<JournalEntry | null> {
  const current = await getJournalEntryById(userId, id);
  if (!current) return null;

  const next: JournalEntry = { ...current };
  if (status === "OPEN") {
    assertOpenReady(current);
  }
  next.status = status;
  next.updatedAt = new Date().toISOString();
  const hydrated = hydrateEntry(next);

  if (!hasPostgres) {
    const store = await readLocalStore();
    store.entries = store.entries.map((entry) => (entry.id === id ? hydrated : entry));
    await writeLocalStore(store);
    return hydrated;
  }

  await ensureDbReady();
  await sql`
    UPDATE journal_trade_entries
    SET status = ${hydrated.status}, updated_at = ${hydrated.updatedAt}::timestamptz
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `;
  return hydrated;
}

export async function softDeleteJournalEntry(userId: string, id: string): Promise<boolean> {
  const nowIso = new Date().toISOString();

  if (!hasPostgres) {
    const store = await readLocalStore();
    const target = store.entries.find((entry) => entry.id === id);
    if (!target || target.deletedAt) return false;
    target.deletedAt = nowIso;
    target.updatedAt = nowIso;
    await writeLocalStore(store);
    return true;
  }

  await ensureDbReady();
  const result = await sql`
    UPDATE journal_trade_entries
    SET deleted_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING id
  `;
  return (result.rowCount ?? 0) > 0;
}
