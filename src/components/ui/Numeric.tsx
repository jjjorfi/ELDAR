import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface NumProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  signed?: boolean;
  color?: boolean;
  compact?: boolean;
  className?: string;
}

function compactFormat(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
  return abs.toFixed(2);
}

function signPrefix(value: number, signed: boolean): string {
  if (value < 0) return "-";
  if (signed && value > 0) return "+";
  return "";
}

function toneClasses(value: number, color: boolean): string | null {
  if (!color) return null;
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-zinc-500";
}

/**
 * Base numeric display with consistent tabular alignment and optional sign/tone formatting.
 */
export function Num({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  signed = false,
  color = false,
  compact = false,
  className
}: NumProps) {
  const sign = signPrefix(value, signed);
  const formatted = compact
    ? compactFormat(value)
    : Math.abs(value).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });

  return (
    <span
      className={cn("font-mono tabular-nums", toneClasses(value, color), className)}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {sign}
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

export interface PctProps {
  value: number;
  decimals?: number;
  signed?: boolean;
  color?: boolean;
  className?: string;
  showParens?: boolean;
}

/**
 * Percentage display with optional signed and accounting-style negative formatting.
 */
export function Pct({
  value,
  decimals = 2,
  signed = true,
  color = true,
  className,
  showParens = false
}: PctProps) {
  const abs = Math.abs(value).toFixed(decimals);
  const formatted = showParens && value < 0 ? `(${abs}%)` : `${signPrefix(value, signed)}${abs}%`;

  return (
    <span
      className={cn("font-mono tabular-nums", toneClasses(value, color), className)}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatted}
    </span>
  );
}

export interface MoneyProps {
  value: number;
  currency?: string;
  decimals?: number;
  compact?: boolean;
  color?: boolean;
  signed?: boolean;
  className?: string;
}

function currencySymbol(currency: string): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  return "$";
}

/**
 * Currency display with compact and standard formatting options.
 */
export function Money({
  value,
  currency = "USD",
  decimals = 2,
  compact = false,
  color = false,
  signed = false,
  className
}: MoneyProps) {
  const sign = signPrefix(value, signed);
  const formatted = compact
    ? `${currencySymbol(currency)}${compactFormat(value)}`
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(Math.abs(value));

  return (
    <span
      className={cn("font-mono tabular-nums", toneClasses(value, color), className)}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {sign}
      {formatted}
    </span>
  );
}

export interface NumTableProps {
  children: ReactNode;
  className?: string;
}

/**
 * Table wrapper that applies tabular numeric rendering across financial cells.
 */
export function NumTable({ children, className }: NumTableProps) {
  return (
    <table className={cn("w-full text-sm", className)} style={{ fontVariantNumeric: "tabular-nums" }}>
      {children}
    </table>
  );
}
