import { getFetchSignal } from "@/lib/market/adapter-utils";

export type IndexCode = "US2000" | "US100" | "US500";

export interface IndexYtdRow {
  code: IndexCode;
  label: string;
  symbol: string;
  current: number | null;
  ytdChangePercent: number | null;
  asOf: string | null;
  points: number[];
  pointDates: string[];
}

export interface IndicesYtdPayload {
  indices: IndexYtdRow[];
}

interface IndexConfig {
  code: IndexCode;
  label: string;
  symbol: string;
  yahooSymbol: string;
}

const INDEX_CONFIGS: IndexConfig[] = [
  { code: "US2000", label: "RUT", symbol: "^rut", yahooSymbol: "^RUT" },
  { code: "US100", label: "US100", symbol: "^ndx", yahooSymbol: "^NDX" },
  { code: "US500", label: "US500", symbol: "^spx", yahooSymbol: "^GSPC" }
];

const MAX_POINTS = 252;
const YAHOO_RANGE = "1y";
const YAHOO_INTERVAL = "1d";
const INDEX_FETCH_TIMEOUT_MS = 3_500;

function currentYear(): number {
  return new Date().getUTCFullYear();
}

function parseCsvNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function downsampleRows<T>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) {
    return rows;
  }

  const step = (rows.length - 1) / (maxPoints - 1);
  const sampled: T[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round(index * step);
    sampled.push(rows[sourceIndex] ?? rows[rows.length - 1]);
  }

  return sampled;
}

function emptyIndexRow(config: IndexConfig, symbolOverride?: string): IndexYtdRow {
  return {
    code: config.code,
    label: config.label,
    symbol: symbolOverride ?? config.yahooSymbol,
    current: null,
    ytdChangePercent: null,
    asOf: null,
    points: [],
    pointDates: []
  };
}

export function isUsableIndexYtdRow(row: IndexYtdRow | null | undefined): row is IndexYtdRow {
  return Boolean(
    row &&
      typeof row.current === "number" &&
      Number.isFinite(row.current) &&
      row.points.length > 0 &&
      row.pointDates.length === row.points.length
  );
}

export function isUsableIndicesYtdPayload(payload: IndicesYtdPayload | null | undefined): payload is IndicesYtdPayload {
  return Boolean(payload && payload.indices.length === INDEX_CONFIGS.length && payload.indices.every((row) => isUsableIndexYtdRow(row)));
}

export function selectPreferredIndexYtdRow(
  primary: IndexYtdRow | null,
  fallback: IndexYtdRow | null,
  empty: IndexYtdRow
): IndexYtdRow {
  if (isUsableIndexYtdRow(primary)) {
    return primary;
  }

  if (isUsableIndexYtdRow(fallback)) {
    return fallback;
  }

  return primary ?? fallback ?? empty;
}

async function fetchStooqYtdRow(config: IndexConfig): Promise<IndexYtdRow | null> {
  const historyUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(config.symbol)}&i=d`;
  const quoteUrl = `https://stooq.com/q/l/?s=${encodeURIComponent(config.symbol)}&f=sd2t2ohlcv&h&e=csv`;

  try {
    const [historyResponse, quoteResponse] = await Promise.all([
      fetch(historyUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: getFetchSignal(INDEX_FETCH_TIMEOUT_MS)
      }),
      fetch(quoteUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: getFetchSignal(INDEX_FETCH_TIMEOUT_MS)
      })
    ]);

    if (!historyResponse.ok) {
      throw new Error(`Stooq history failed with status ${historyResponse.status}`);
    }

    const csv = await historyResponse.text();
    const lines = csv
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
      return emptyIndexRow(config, config.symbol.toUpperCase());
    }

    const rows = lines
      .slice(1)
      .map((line) => {
        const columns = line.split(",");
        const isoDate = columns[0] ?? "";
        const close = parseCsvNumber(columns[4]);
        const asOfMs = Date.parse(`${isoDate}T00:00:00Z`);

        if (!Number.isFinite(asOfMs) || close === null) {
          return null;
        }

        return { isoDate, asOfMs, close };
      })
      .filter((row): row is { isoDate: string; asOfMs: number; close: number } => row !== null);

    if (rows.length === 0) {
      return emptyIndexRow(config, config.symbol.toUpperCase());
    }

    const latestHistory = rows[rows.length - 1];
    let latestClose = latestHistory?.close ?? null;
    let asOfDate = latestHistory?.isoDate ?? null;

    if (quoteResponse.ok) {
      const quoteCsv = await quoteResponse.text();
      const quoteLines = quoteCsv
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      if (quoteLines.length >= 2) {
        const columns = quoteLines[1]?.split(",") ?? [];
        const quoteDate = columns[1] ?? null;
        const quoteClose = parseCsvNumber(columns[6]);
        if (quoteClose !== null) {
          latestClose = quoteClose;
        }
        if (quoteDate) {
          asOfDate = quoteDate;
        }
      }
    }

    const ytdRows = rows.filter((row) => row.isoDate.startsWith(`${new Date().getUTCFullYear()}-`));
    const chartRows = rows.slice(Math.max(0, rows.length - 260));
    const startClose = ytdRows[0]?.close ?? rows[0]?.close ?? null;

    const ytdChangePercent =
      startClose !== null && latestClose !== null && startClose !== 0
        ? ((latestClose - startClose) / startClose) * 100
        : null;

    const sampledRows = downsampleRows(chartRows, MAX_POINTS);

    return {
      code: config.code,
      label: config.label,
      symbol: config.symbol.toUpperCase(),
      current: latestClose,
      ytdChangePercent,
      asOf: asOfDate,
      points: sampledRows.map((row) => row.close),
      pointDates: sampledRows.map((row) => row.isoDate)
    };
  } catch {
    return null;
  }
}

async function fetchYahooYtdRow(config: IndexConfig): Promise<IndexYtdRow | null> {
  const baseUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.yahooSymbol)}`;
  const url = `${baseUrl}?interval=${YAHOO_INTERVAL}&range=${YAHOO_RANGE}`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: getFetchSignal(INDEX_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!response.ok) {
      throw new Error(`Yahoo chart failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
            }>;
          };
          meta?: {
            regularMarketPrice?: number;
            symbol?: string;
          };
        }>;
      };
    };

    const result = payload.chart?.result?.[0];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];

    const rows = timestamps
      .map((ts, index) => {
        const close = closes[index];
        if (typeof close !== "number" || !Number.isFinite(close)) return null;
        const date = new Date(ts * 1000);
        if (Number.isNaN(date.getTime())) return null;
        return {
          isoDate: date.toISOString().slice(0, 10),
          close
        };
      })
      .filter((row): row is { isoDate: string; close: number } => row !== null);

    if (rows.length === 0) {
      throw new Error("Yahoo chart returned no usable rows.");
    }

    const latest = rows[rows.length - 1];
    const ytdRows = rows.filter((row) => row.isoDate.startsWith(`${currentYear()}-`));
    const startClose = ytdRows[0]?.close ?? rows[0]?.close ?? null;
    const latestClose = latest?.close ?? result?.meta?.regularMarketPrice ?? null;
    const ytdChangePercent =
      typeof latestClose === "number" && startClose !== null && startClose !== 0
        ? ((latestClose - startClose) / startClose) * 100
        : null;

    const sampledRows = downsampleRows(rows, MAX_POINTS);

    return {
      code: config.code,
      label: config.label,
      symbol: result?.meta?.symbol ?? config.yahooSymbol,
      current: typeof latestClose === "number" ? latestClose : null,
      ytdChangePercent,
      asOf: latest?.isoDate ?? null,
      points: sampledRows.map((row) => row.close),
      pointDates: sampledRows.map((row) => row.isoDate)
    };
  } catch {
    return null;
  }
}

async function fetchPreferredIndexYtdRow(config: IndexConfig): Promise<IndexYtdRow> {
  const yahoo = await fetchYahooYtdRow(config);
  if (isUsableIndexYtdRow(yahoo)) {
    return yahoo;
  }

  const stooq = await fetchStooqYtdRow(config);
  return selectPreferredIndexYtdRow(yahoo, stooq, emptyIndexRow(config));
}

export function emptyIndicesYtdPayload(): IndicesYtdPayload {
  return {
    indices: INDEX_CONFIGS.map((config) => emptyIndexRow(config))
  };
}

export async function buildIndicesYtdAggregate(): Promise<IndicesYtdPayload> {
  const indices = await Promise.all(INDEX_CONFIGS.map((config) => fetchPreferredIndexYtdRow(config)));
  return { indices };
}
