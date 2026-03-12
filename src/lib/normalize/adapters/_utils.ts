import type { DataProvenance, DataSource } from "@/lib/normalize/types/canonical";

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

export function parseFloatOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function parseIntOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Math.round(value);
  return Number.isFinite(n) ? n : null;
}

export function toUpperTicker(raw: string | null | undefined): string {
  if (!raw || raw.trim().length === 0) {
    throw new AdapterError("ticker is null or empty");
  }

  return raw
    .trim()
    .toUpperCase()
    .replace(":NASDAQ", "")
    .replace(":NYSE", "")
    .replace("/", "-");
}

export function toISODate(raw: string | number | null): string | null {
  if (raw == null) return null;

  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const parsed = new Date(ms);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function parseDateOnly(raw: string | number | null): string | null {
  const iso = toISODate(raw);
  return iso ? iso.slice(0, 10) : null;
}

export function defaultProvenance(
  source: DataSource,
  fetchedAt: string,
  options?: {
    delayMins?: number;
    stale?: boolean;
    staleMins?: number;
    conflicted?: boolean;
    imputed?: string[];
    warnings?: string[];
  }
): DataProvenance {
  return {
    source,
    fetchedAt,
    delayMins: options?.delayMins ?? 0,
    stale: options?.stale ?? false,
    staleMins: options?.staleMins ?? 0,
    conflicted: options?.conflicted ?? false,
    imputed: options?.imputed ?? [],
    warnings: options?.warnings ?? []
  };
}

export function normalizeRatioOrNull(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) > 1) return value / 100;
  return value;
}
