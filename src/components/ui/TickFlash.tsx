"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Returns a temporary flash direction whenever a numeric value changes.
 *
 * @param value Current numeric value.
 * @returns Flash direction for the latest tick, or null when idle.
 */
export function useTickFlash(value: number): "up" | "down" | null {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (prev.current === null) {
      prev.current = value;
      return;
    }

    if (value === prev.current) {
      return;
    }

    const direction = value > prev.current ? "up" : "down";
    prev.current = value;
    setFlash(direction);

    const timeout = window.setTimeout(() => setFlash(null), 700);
    return () => window.clearTimeout(timeout);
  }, [value]);

  return flash;
}

export interface TickCellProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  showArrow?: boolean;
  showDelta?: boolean;
}

/**
 * Renders a flashing quote cell for live price updates.
 */
export function TickCell({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  className,
  showArrow = false,
  showDelta = false
}: TickCellProps) {
  const flash = useTickFlash(value);
  const prevRef = useRef<number>(value);
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    if (prevRef.current !== value) {
      setDelta(value - prevRef.current);
      prevRef.current = value;
    }
  }, [value]);

  const formatted = `${prefix}${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}${suffix}`;

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono tabular-nums", className)}>
      <span
        className={cn(
          "inline-block rounded px-1.5 py-0.5 transition-all",
          flash === "up" && "bg-emerald-500/20 text-emerald-300",
          flash === "down" && "bg-red-500/20 text-red-300",
          !flash && "bg-transparent text-zinc-200"
        )}
        style={{ transition: flash ? "none" : "background 0.6s ease, color 0.6s ease" }}
      >
        {formatted}
      </span>

      {showArrow && flash && (
        <span className={cn("transition-opacity", flash === "up" ? "text-emerald-400" : "text-red-400")}>
          {flash === "up" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        </span>
      )}

      {showDelta && delta !== 0 && (
        <span
          className={cn(
            "rounded px-1 text-xs",
            delta > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
          )}
        >
          {delta > 0 ? "+" : ""}
          {delta.toFixed(decimals)}
        </span>
      )}
    </span>
  );
}

export interface TickerRowProps {
  symbol: string;
  name?: string;
  price: number;
  changePercent: number;
  volume?: number;
  sparkData?: number[];
  className?: string;
}

/**
 * Renders a live ticker table row with flash feedback on price changes.
 */
export function TickerRow({
  symbol,
  name,
  price,
  changePercent,
  volume,
  sparkData: _sparkData,
  className
}: TickerRowProps) {
  const flash = useTickFlash(price);
  const isPositive = changePercent > 0;
  const isNegative = changePercent < 0;

  return (
    <tr
      className={cn(
        "border-b border-white/6 transition-colors hover:bg-white/4",
        flash === "up" && "bg-emerald-500/5",
        flash === "down" && "bg-red-500/5",
        !flash && "bg-transparent",
        className
      )}
      style={{ transition: flash ? "none" : "background 0.6s ease" }}
    >
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-medium text-zinc-100">{symbol}</span>
          {name ? <span className="max-w-[120px] truncate text-xs text-zinc-500">{name}</span> : null}
        </div>
      </td>

      <td className="px-4 py-3 text-right">
        <TickCell value={price} prefix="$" decimals={2} showArrow />
      </td>

      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-sm font-mono tabular-nums",
            isPositive && "text-emerald-400",
            isNegative && "text-red-400",
            !isPositive && !isNegative && "text-zinc-400"
          )}
        >
          {isPositive ? <TrendingUp size={12} /> : isNegative ? <TrendingDown size={12} /> : <Minus size={12} />}
          {isPositive ? "+" : ""}
          {changePercent.toFixed(2)}%
        </span>
      </td>

      {volume !== undefined ? (
        <td className="px-4 py-3 text-right">
          <span className="text-sm font-mono tabular-nums text-zinc-500">
            {volume >= 1_000_000
              ? `${(volume / 1_000_000).toFixed(1)}M`
              : volume >= 1_000
                ? `${(volume / 1_000).toFixed(0)}K`
                : volume}
          </span>
        </td>
      ) : null}
    </tr>
  );
}
