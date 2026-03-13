import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function sanitizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z.\-]/g, "");
}

export function safeNumber(value: unknown): number | null {
  if (typeof value !== "number") {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

export function normalizeRatio(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (Math.abs(value) > 10) {
    return value / 100;
  }

  return value;
}

export function formatPercent(value: number | null): string {
  if (value === null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return "N/A";
  return value.toFixed(digits);
}

export function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatMarketCap(value: number | null): string {
  if (value === null) return "N/A";

  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  }

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  return value.toFixed(0);
}
