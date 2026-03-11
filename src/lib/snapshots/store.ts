import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "@vercel/postgres";

import { hasPostgres } from "@/lib/storage/shared";

import type {
  AggregateSnapshotContract,
  EnqueueSnapshotJobInput,
  SnapshotJobRecord,
  SnapshotMetrics,
  SymbolSnapshotContract
} from "@/lib/snapshots/contracts";
import { SNAPSHOT_PRIORITY_SCORE } from "@/lib/snapshots/contracts";

const LOCAL_STORE_PATH = path.join(process.cwd(), ".cache", "snapshot-store.json");

interface LocalSnapshotStoreShape {
  snapshots: Record<string, SymbolSnapshotContract>;
  aggregateSnapshots: Record<string, AggregateSnapshotContract>;
  jobs: SnapshotJobRecord[];
}

let tablesEnsured = false;
let localMutationQueue: Promise<void> = Promise.resolve();

function newId(): string {
  return crypto.randomUUID();
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function parseDateMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyLocalStore(): LocalSnapshotStoreShape {
  return {
    snapshots: {},
    aggregateSnapshots: {},
    jobs: []
  };
}

async function readLocalStore(): Promise<LocalSnapshotStoreShape> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as LocalSnapshotStoreShape;
    if (typeof parsed !== "object" || parsed === null) return emptyLocalStore();
    const snapshots = typeof parsed.snapshots === "object" && parsed.snapshots !== null ? parsed.snapshots : {};
    const aggregateSnapshots =
      typeof parsed.aggregateSnapshots === "object" && parsed.aggregateSnapshots !== null ? parsed.aggregateSnapshots : {};
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    return { snapshots, aggregateSnapshots, jobs };
  } catch {
    return emptyLocalStore();
  }
}

async function writeLocalStore(store: LocalSnapshotStoreShape): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(store), "utf8");
}

async function withLocalStoreMutation<T>(mutate: (store: LocalSnapshotStoreShape) => Promise<T> | T): Promise<T> {
  const run = async (): Promise<T> => {
    const store = await readLocalStore();
    const result = await mutate(store);
    await writeLocalStore(store);
    return result;
  };

  const next = localMutationQueue.then(run, run);
  localMutationQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function rowToJob(row: {
  id: string;
  symbol: string;
  priority: number;
  status: string;
  reason: string;
  requested_by: string | null;
  attempts: number;
  max_attempts: number;
  not_before: string;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}): SnapshotJobRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    priority: row.priority,
    status: row.status as SnapshotJobRecord["status"],
    reason: row.reason,
    requestedBy: row.requested_by,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    notBefore: row.not_before,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    lastError: row.last_error,
    payload: row.payload ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function ensureSnapshotStore(): Promise<void> {
  if (!hasPostgres || tablesEnsured) return;

  await sql`
    CREATE TABLE IF NOT EXISTS symbol_snapshots (
      symbol TEXT PRIMARY KEY,
      snapshot JSONB NOT NULL,
      schema_version TEXT NOT NULL,
      data_state TEXT NOT NULL,
      build_ms INTEGER,
      analysis_expires_at TIMESTAMPTZ NOT NULL,
      fundamentals_expires_at TIMESTAMPTZ NOT NULL,
      context_expires_at TIMESTAMPTZ NOT NULL,
      news_expires_at TIMESTAMPTZ NOT NULL,
      built_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE symbol_snapshots ADD COLUMN IF NOT EXISTS build_ms INTEGER`;
  await sql`CREATE INDEX IF NOT EXISTS symbol_snapshots_updated_idx ON symbol_snapshots(updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS symbol_snapshots_data_state_idx ON symbol_snapshots(data_state, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS symbol_snapshots_build_ms_idx ON symbol_snapshots(build_ms)`;

  await sql`
    CREATE TABLE IF NOT EXISTS aggregate_snapshots (
      key TEXT PRIMARY KEY,
      snapshot JSONB NOT NULL,
      schema_version TEXT NOT NULL,
      state TEXT NOT NULL,
      freshness_class TEXT NOT NULL,
      build_ms INTEGER,
      expires_at TIMESTAMPTZ NOT NULL,
      built_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE aggregate_snapshots ADD COLUMN IF NOT EXISTS build_ms INTEGER`;
  await sql`CREATE INDEX IF NOT EXISTS aggregate_snapshots_updated_idx ON aggregate_snapshots(updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS aggregate_snapshots_expires_idx ON aggregate_snapshots(expires_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS symbol_snapshot_jobs (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      priority INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_by TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      not_before TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_by TEXT,
      locked_at TIMESTAMPTZ,
      last_error TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS symbol_snapshot_jobs_pick_idx
    ON symbol_snapshot_jobs(status, priority DESC, not_before ASC, created_at ASC)
  `;
  await sql`CREATE INDEX IF NOT EXISTS symbol_snapshot_jobs_symbol_idx ON symbol_snapshot_jobs(symbol, status, created_at DESC)`;

  tablesEnsured = true;
}

export async function getSymbolSnapshot(symbol: string): Promise<SymbolSnapshotContract | null> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;

  if (!hasPostgres) {
    const store = await readLocalStore();
    return store.snapshots[normalized] ?? null;
  }

  await ensureSnapshotStore();
  const { rows } = await sql<{ snapshot: SymbolSnapshotContract }>`
    SELECT snapshot
    FROM symbol_snapshots
    WHERE symbol = ${normalized}
    LIMIT 1
  `;
  return rows[0]?.snapshot ?? null;
}

export async function upsertSymbolSnapshot(snapshot: SymbolSnapshotContract): Promise<void> {
  const normalized = normalizeSymbol(snapshot.symbol);
  const analysisExpiry = snapshot.modules.analysis.state.expiresAt;
  const fundamentalsExpiry = snapshot.modules.fundamentals.state.expiresAt;
  const contextExpiry = snapshot.modules.context.state.expiresAt;
  const newsExpiry = snapshot.modules.news.state.expiresAt;

  if (!hasPostgres) {
    await withLocalStoreMutation((store) => {
      store.snapshots[normalized] = snapshot;
    });
    return;
  }

  await ensureSnapshotStore();
  await sql`
    INSERT INTO symbol_snapshots (
      symbol,
      snapshot,
      schema_version,
      data_state,
      build_ms,
      analysis_expires_at,
      fundamentals_expires_at,
      context_expires_at,
      news_expires_at,
      built_at,
      updated_at
    )
    VALUES (
      ${normalized},
      ${JSON.stringify(snapshot)}::jsonb,
      ${snapshot.schemaVersion},
      ${snapshot.quality.dataState},
      ${snapshot.trace.lastBuildMs},
      ${analysisExpiry},
      ${fundamentalsExpiry},
      ${contextExpiry},
      ${newsExpiry},
      ${snapshot.asOf},
      NOW()
    )
    ON CONFLICT (symbol)
    DO UPDATE SET
      snapshot = EXCLUDED.snapshot,
      schema_version = EXCLUDED.schema_version,
      data_state = EXCLUDED.data_state,
      build_ms = EXCLUDED.build_ms,
      analysis_expires_at = EXCLUDED.analysis_expires_at,
      fundamentals_expires_at = EXCLUDED.fundamentals_expires_at,
      context_expires_at = EXCLUDED.context_expires_at,
      news_expires_at = EXCLUDED.news_expires_at,
      built_at = EXCLUDED.built_at,
      updated_at = NOW()
  `;
}

export async function getAggregateSnapshot<T = unknown>(key: string): Promise<AggregateSnapshotContract<T> | null> {
  const normalized = key.trim();
  if (!normalized) return null;

  if (!hasPostgres) {
    const store = await readLocalStore();
    const row = store.aggregateSnapshots[normalized] as AggregateSnapshotContract<T> | undefined;
    return row ?? null;
  }

  await ensureSnapshotStore();
  const { rows } = await sql<{ snapshot: AggregateSnapshotContract<T> }>`
    SELECT snapshot
    FROM aggregate_snapshots
    WHERE key = ${normalized}
    LIMIT 1
  `;
  return rows[0]?.snapshot ?? null;
}

export async function upsertAggregateSnapshot<T>(snapshot: AggregateSnapshotContract<T>): Promise<void> {
  const normalized = snapshot.key.trim();
  if (!normalized) return;

  if (!hasPostgres) {
    await withLocalStoreMutation((store) => {
      store.aggregateSnapshots[normalized] = snapshot as AggregateSnapshotContract;
    });
    return;
  }

  await ensureSnapshotStore();
  await sql`
    INSERT INTO aggregate_snapshots (
      key,
      snapshot,
      schema_version,
      state,
      freshness_class,
      build_ms,
      expires_at,
      built_at,
      updated_at
    )
    VALUES (
      ${normalized},
      ${JSON.stringify(snapshot)}::jsonb,
      ${snapshot.schemaVersion},
      ${snapshot.state},
      ${snapshot.freshnessClass},
      ${snapshot.trace.lastBuildMs},
      ${snapshot.expiresAt},
      ${snapshot.builtAt},
      NOW()
    )
    ON CONFLICT (key)
    DO UPDATE SET
      snapshot = EXCLUDED.snapshot,
      schema_version = EXCLUDED.schema_version,
      state = EXCLUDED.state,
      freshness_class = EXCLUDED.freshness_class,
      build_ms = EXCLUDED.build_ms,
      expires_at = EXCLUDED.expires_at,
      built_at = EXCLUDED.built_at,
      updated_at = NOW()
  `;
}

export async function enqueueSnapshotJob(input: EnqueueSnapshotJobInput): Promise<{ id: string; created: boolean }> {
  const symbol = normalizeSymbol(input.symbol);
  const now = nowIso();
  const requestedPriority = SNAPSHOT_PRIORITY_SCORE[input.priority];

  if (!hasPostgres) {
    return withLocalStoreMutation((store) => {
      const existing = store.jobs.find((job) => job.symbol === symbol && (job.status === "queued" || job.status === "running"));
      if (existing) {
        if (existing.status === "queued") {
          existing.priority = Math.max(existing.priority, requestedPriority);
          existing.reason = input.reason;
          existing.payload = input.payload ?? {};
          existing.notBefore = now;
          existing.lockedBy = null;
          existing.lockedAt = null;
          existing.lastError = null;
          existing.updatedAt = now;
        }
        return { id: existing.id, created: false };
      }

      const job: SnapshotJobRecord = {
        id: newId(),
        symbol,
        priority: requestedPriority,
        status: "queued",
        reason: input.reason,
        requestedBy: input.requestedBy,
        attempts: 0,
        maxAttempts: 5,
        notBefore: now,
        lockedBy: null,
        lockedAt: null,
        lastError: null,
        payload: input.payload ?? {},
        createdAt: now,
        updatedAt: now
      };
      store.jobs.push(job);
      return { id: job.id, created: true };
    });
  }

  await ensureSnapshotStore();
  const active = await sql<{
    id: string;
    status: string;
    priority: number;
    not_before: string;
  }>`
    SELECT id, status, priority, not_before::text
    FROM symbol_snapshot_jobs
    WHERE symbol = ${symbol}
      AND status IN ('queued', 'running')
    ORDER BY priority DESC, created_at DESC
    LIMIT 1
  `;

  const existing = active.rows[0];
  if (existing) {
    if (existing.status === "queued") {
      await sql`
        UPDATE symbol_snapshot_jobs
        SET priority = ${Math.max(existing.priority, requestedPriority)},
            reason = ${input.reason},
            payload = ${JSON.stringify(input.payload ?? {})}::jsonb,
            not_before = NOW(),
            locked_by = NULL,
            locked_at = NULL,
            last_error = NULL,
            updated_at = NOW()
        WHERE id = ${existing.id}
      `;
    }
    return { id: existing.id, created: false };
  }

  const id = newId();
  await sql`
    INSERT INTO symbol_snapshot_jobs (
      id,
      symbol,
      priority,
      status,
      reason,
      requested_by,
      attempts,
      max_attempts,
      not_before,
      payload,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      ${symbol},
      ${requestedPriority},
      'queued',
      ${input.reason},
      ${input.requestedBy},
      0,
      5,
      NOW(),
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      NOW(),
      NOW()
    )
  `;
  return { id, created: true };
}

export async function claimSnapshotJobs(limit: number, workerId: string): Promise<SnapshotJobRecord[]> {
  const normalizedLimit = Math.max(1, Math.min(50, limit));

  if (!hasPostgres) {
    return withLocalStoreMutation((store) => {
      const nowMs = Date.now();
      const queued = store.jobs
        .filter((job) => job.status === "queued" && parseDateMs(job.notBefore) <= nowMs)
        .sort((a, b) => b.priority - a.priority || parseDateMs(a.createdAt) - parseDateMs(b.createdAt))
        .slice(0, normalizedLimit);

      const claimedAt = nowIso();
      for (const job of queued) {
        job.status = "running";
        job.lockedBy = workerId;
        job.lockedAt = claimedAt;
        job.updatedAt = claimedAt;
      }
      return queued;
    });
  }

  await ensureSnapshotStore();
  const { rows } = await sql<{
    id: string;
    symbol: string;
    priority: number;
    status: string;
    reason: string;
    requested_by: string | null;
    attempts: number;
    max_attempts: number;
    not_before: string;
    locked_by: string | null;
    locked_at: string | null;
    last_error: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }>`
    WITH picked AS (
      SELECT id
      FROM symbol_snapshot_jobs
      WHERE status = 'queued'
        AND not_before <= NOW()
      ORDER BY priority DESC, created_at ASC
      LIMIT ${normalizedLimit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE symbol_snapshot_jobs AS jobs
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = NOW(),
        updated_at = NOW()
    FROM picked
    WHERE jobs.id = picked.id
    RETURNING
      jobs.id,
      jobs.symbol,
      jobs.priority,
      jobs.status,
      jobs.reason,
      jobs.requested_by,
      jobs.attempts,
      jobs.max_attempts,
      jobs.not_before::text,
      jobs.locked_by,
      jobs.locked_at::text,
      jobs.last_error,
      jobs.payload,
      jobs.created_at::text,
      jobs.updated_at::text
  `;

  return rows.map(rowToJob);
}

export async function completeSnapshotJob(jobId: string): Promise<void> {
  if (!hasPostgres) {
    await withLocalStoreMutation((store) => {
      const now = nowIso();
      const job = store.jobs.find((item) => item.id === jobId);
      if (!job) return;
      job.status = "done";
      job.updatedAt = now;
    });
    return;
  }

  await ensureSnapshotStore();
  await sql`
    UPDATE symbol_snapshot_jobs
    SET status = 'done',
        updated_at = NOW()
    WHERE id = ${jobId}
  `;
}

export async function failSnapshotJob(jobId: string, errorMessage: string): Promise<"retried" | "dead"> {
  const now = nowIso();
  const retryDelaySeconds = 30;

  if (!hasPostgres) {
    return withLocalStoreMutation((store) => {
      const job = store.jobs.find((item) => item.id === jobId);
      if (!job) return "dead" as const;

      const nextAttempts = job.attempts + 1;
      job.attempts = nextAttempts;
      job.lastError = errorMessage.slice(0, 1_500);
      job.lockedBy = null;
      job.lockedAt = null;
      job.updatedAt = now;

      if (nextAttempts >= job.maxAttempts) {
        job.status = "dead";
        return "dead" as const;
      }

      job.status = "queued";
      job.notBefore = new Date(Date.now() + retryDelaySeconds * 1_000 * nextAttempts).toISOString();
      return "retried" as const;
    });
  }

  await ensureSnapshotStore();

  const current = await sql<{ attempts: number; max_attempts: number }>`
    SELECT attempts, max_attempts
    FROM symbol_snapshot_jobs
    WHERE id = ${jobId}
    LIMIT 1
  `;
  if (current.rows.length === 0) return "dead";

  const attempts = current.rows[0].attempts + 1;
  const maxAttempts = current.rows[0].max_attempts;
  if (attempts >= maxAttempts) {
    await sql`
      UPDATE symbol_snapshot_jobs
      SET status = 'dead',
          attempts = ${attempts},
          last_error = ${errorMessage.slice(0, 1_500)},
          locked_by = NULL,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = ${jobId}
    `;
    return "dead";
  }

  const retryAt = new Date(Date.now() + retryDelaySeconds * 1_000 * attempts).toISOString();
  await sql`
    UPDATE symbol_snapshot_jobs
    SET status = 'queued',
        attempts = ${attempts},
        not_before = ${retryAt},
        last_error = ${errorMessage.slice(0, 1_500)},
        locked_by = NULL,
        locked_at = NULL,
        updated_at = NOW()
    WHERE id = ${jobId}
  `;
  return "retried";
}

export async function listDeadSnapshotJobs(limit = 50): Promise<SnapshotJobRecord[]> {
  const normalizedLimit = Math.max(1, Math.min(500, limit));

  if (!hasPostgres) {
    const store = await readLocalStore();
    return store.jobs
      .filter((job) => job.status === "dead")
      .sort((a, b) => parseDateMs(b.updatedAt) - parseDateMs(a.updatedAt))
      .slice(0, normalizedLimit);
  }

  await ensureSnapshotStore();
  const { rows } = await sql<{
    id: string;
    symbol: string;
    priority: number;
    status: string;
    reason: string;
    requested_by: string | null;
    attempts: number;
    max_attempts: number;
    not_before: string;
    locked_by: string | null;
    locked_at: string | null;
    last_error: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }>`
    SELECT
      id,
      symbol,
      priority,
      status,
      reason,
      requested_by,
      attempts,
      max_attempts,
      not_before::text,
      locked_by,
      locked_at::text,
      last_error,
      payload,
      created_at::text,
      updated_at::text
    FROM symbol_snapshot_jobs
    WHERE status = 'dead'
    ORDER BY updated_at DESC
    LIMIT ${normalizedLimit}
  `;

  return rows.map(rowToJob);
}

export async function requeueDeadSnapshotJobs(options?: {
  limit?: number;
  symbol?: string | null;
  jobIds?: string[];
}): Promise<{ requeued: number }> {
  const limit = Math.max(1, Math.min(500, options?.limit ?? 50));
  const symbol = options?.symbol ? normalizeSymbol(options.symbol) : null;
  const jobIds = Array.isArray(options?.jobIds)
    ? Array.from(new Set(options.jobIds.map((id) => id.trim()).filter((id) => id.length > 0)))
    : [];

  if (!hasPostgres) {
    return withLocalStoreMutation((store) => {
      const now = nowIso();
      let candidates = store.jobs.filter((job) => job.status === "dead");
      if (symbol) {
        candidates = candidates.filter((job) => job.symbol === symbol);
      }
      if (jobIds.length > 0) {
        const allowed = new Set(jobIds);
        candidates = candidates.filter((job) => allowed.has(job.id));
      }
      candidates = candidates
        .sort((a, b) => parseDateMs(b.updatedAt) - parseDateMs(a.updatedAt))
        .slice(0, limit);

      for (const job of candidates) {
        job.status = "queued";
        job.attempts = 0;
        job.notBefore = now;
        job.lockedBy = null;
        job.lockedAt = null;
        job.lastError = null;
        job.updatedAt = now;
      }
      return { requeued: candidates.length };
    });
  }

  await ensureSnapshotStore();

  if (jobIds.length > 0) {
    let requeued = 0;
    for (const id of jobIds.slice(0, limit)) {
      const result = await sql<{ id: string }>`
        UPDATE symbol_snapshot_jobs
        SET status = 'queued',
            attempts = 0,
            not_before = NOW(),
            locked_by = NULL,
            locked_at = NULL,
            last_error = NULL,
            updated_at = NOW()
        WHERE id = ${id}
          AND status = 'dead'
        RETURNING id
      `;
      requeued += result.rows.length;
    }
    return { requeued };
  }

  const query = symbol
    ? sql<{ id: string }>`
        WITH picked AS (
          SELECT id
          FROM symbol_snapshot_jobs
          WHERE status = 'dead'
            AND symbol = ${symbol}
          ORDER BY updated_at DESC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE symbol_snapshot_jobs AS jobs
        SET status = 'queued',
            attempts = 0,
            not_before = NOW(),
            locked_by = NULL,
            locked_at = NULL,
            last_error = NULL,
            updated_at = NOW()
        FROM picked
        WHERE jobs.id = picked.id
        RETURNING jobs.id
      `
    : sql<{ id: string }>`
        WITH picked AS (
          SELECT id
          FROM symbol_snapshot_jobs
          WHERE status = 'dead'
          ORDER BY updated_at DESC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE symbol_snapshot_jobs AS jobs
        SET status = 'queued',
            attempts = 0,
            not_before = NOW(),
            locked_by = NULL,
            locked_at = NULL,
            last_error = NULL,
            updated_at = NOW()
        FROM picked
        WHERE jobs.id = picked.id
        RETURNING jobs.id
      `;

  const result = await query;
  return { requeued: result.rows.length };
}

export async function getSnapshotMetrics(): Promise<SnapshotMetrics> {
  if (!hasPostgres) {
    const store = await readLocalStore();
    const queued = store.jobs.filter((job) => job.status === "queued").length;
    const running = store.jobs.filter((job) => job.status === "running").length;
    const dead = store.jobs.filter((job) => job.status === "dead").length;
    const total = Object.keys(store.snapshots).length;
    const now = Date.now();
    const staleSymbol = Object.values(store.snapshots).filter((snapshot) => {
      const expiries = [
        snapshot.modules.analysis.state.expiresAt,
        snapshot.modules.fundamentals.state.expiresAt,
        snapshot.modules.context.state.expiresAt,
        snapshot.modules.news.state.expiresAt
      ];
      return expiries.some((value) => parseDateMs(value) <= now);
    }).length;
    const staleAggregate = Object.values(store.aggregateSnapshots).filter((snapshot) => parseDateMs(snapshot.expiresAt) <= now).length;
    return {
      queue: { queued, running, dead },
      snapshots: { total, stale: staleSymbol + staleAggregate }
    };
  }

  await ensureSnapshotStore();
  const [jobCounts, queueAge, symbolCounts, aggregateStale, percentiles] = await Promise.all([
    sql<{ queued: string; running: string; dead: string }>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
        COUNT(*) FILTER (WHERE status = 'running')::text AS running,
        COUNT(*) FILTER (WHERE status = 'dead')::text AS dead
      FROM symbol_snapshot_jobs
    `,
    sql<{ avg_age_sec: string }>`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at))), 0)::text AS avg_age_sec
      FROM symbol_snapshot_jobs
      WHERE status = 'queued'
    `,
    sql<{ total: string; stale: string }>`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (
          WHERE
            analysis_expires_at <= NOW()
            OR fundamentals_expires_at <= NOW()
            OR context_expires_at <= NOW()
            OR news_expires_at <= NOW()
        )::text AS stale
      FROM symbol_snapshots
    `,
    sql<{ stale: string }>`
      SELECT
        COUNT(*) FILTER (WHERE expires_at <= NOW())::text AS stale
      FROM aggregate_snapshots
    `,
    sql<{ p50: string | null; p95: string | null }>`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY build_ms)::text AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY build_ms)::text AS p95
      FROM symbol_snapshots
      WHERE build_ms IS NOT NULL
    `
  ]);

  const jobRow = jobCounts.rows[0] ?? { queued: "0", running: "0", dead: "0" };
  const queueAgeRow = queueAge.rows[0] ?? { avg_age_sec: "0" };
  const symbolRow = symbolCounts.rows[0] ?? { total: "0", stale: "0" };
  const aggregateStaleRow = aggregateStale.rows[0] ?? { stale: "0" };
  const percentileRow = percentiles.rows[0] ?? { p50: null, p95: null };

  return {
    queue: {
      queued: Number.parseInt(jobRow.queued, 10) || 0,
      running: Number.parseInt(jobRow.running, 10) || 0,
      dead: Number.parseInt(jobRow.dead, 10) || 0,
      avgQueuedAgeSec: Number.parseFloat(queueAgeRow.avg_age_sec) || 0
    },
    snapshots: {
      total: Number.parseInt(symbolRow.total, 10) || 0,
      stale: (Number.parseInt(symbolRow.stale, 10) || 0) + (Number.parseInt(aggregateStaleRow.stale, 10) || 0),
      p50BuildMs: percentileRow.p50 !== null ? Number.parseFloat(percentileRow.p50) : undefined,
      p95BuildMs: percentileRow.p95 !== null ? Number.parseFloat(percentileRow.p95) : undefined
    }
  };
}
