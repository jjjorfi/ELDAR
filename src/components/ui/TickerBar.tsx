"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LiveQuotePayload } from "@/lib/features/price/types";
import { cn } from "@/lib/utils";

export type TickerItem = {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
};

type TickerBarProps = {
  items: TickerItem[];
  speed?: number;
  className?: string;
  pauseOnHover?: boolean;
};

type UseTickerDataOptions = {
  symbols: string[];
  fetchPrices: (symbols: string[]) => Promise<TickerItem[]>;
  refreshInterval?: number;
};

const APP_TICKER_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "AAPL", "MSFT", "NVDA", "AMZN"] as const;

function estimateAbsoluteChange(price: number | null, changePercent: number | null): number {
  if (price === null || changePercent === null) return 0;
  const divisor = 1 + changePercent / 100;
  if (!Number.isFinite(divisor) || divisor === 0) return 0;
  const previousClose = price / divisor;
  if (!Number.isFinite(previousClose)) return 0;
  return price - previousClose;
}

function normalizeTickerItem(row: LiveQuotePayload["quotes"][number] | null): TickerItem | null {
  if (!row) return null;
  if (row.price === null || !Number.isFinite(row.price)) return null;
  const changePercent = row.changePercent ?? 0;
  return {
    symbol: row.symbol,
    price: row.price,
    changePercent,
    change: estimateAbsoluteChange(row.price, row.changePercent)
  };
}

export function TickerBar({
  items,
  speed = 40,
  className,
  pauseOnHover = true
}: TickerBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const contentWidth = track.scrollWidth / 2;
    setDuration(contentWidth / speed);
  }, [items, speed]);

  if (items.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
      <div
        className={cn(
          "w-full overflow-hidden border-b border-white/6 bg-zinc-950/80 backdrop-blur-sm",
          className
        )}
        style={{ height: "2rem" }}
        onMouseEnter={() => pauseOnHover && setPaused(true)}
        onMouseLeave={() => pauseOnHover && setPaused(false)}
      >
        <div
          ref={trackRef}
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            whiteSpace: "nowrap",
            animation: duration > 0 ? `ticker-scroll ${duration}s linear infinite` : undefined,
            animationPlayState: paused ? "paused" : "running"
          }}
        >
          {[0, 1].map((pass) => (
            <span key={pass} style={{ display: "flex", alignItems: "center" }}>
              {items.map((item, index) => (
                <TickerBarItem key={`${pass}-${item.symbol}-${index}`} item={item} />
              ))}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

function TickerBarItem({ item }: { item: TickerItem }) {
  const isPositive = item.changePercent >= 0;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0 1.25rem",
        fontSize: "0.7rem",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        height: "100%",
        fontVariantNumeric: "tabular-nums"
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 500, letterSpacing: "0.04em" }}>
        {item.symbol}
      </span>
      <span style={{ color: "rgba(255,255,255,0.85)", fontFamily: "monospace" }}>
        ${item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span style={{ color: isPositive ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>
        {isPositive ? "▲" : "▼"}
        {Math.abs(item.changePercent).toFixed(2)}%
      </span>
    </span>
  );
}

export function useTickerData({
  symbols,
  fetchPrices,
  refreshInterval = 15_000
}: UseTickerDataOptions) {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchPrices(symbols);
        if (!cancelled) {
          setItems(data);
          setLoading(false);
        }
      } catch (error) {
        console.error("Ticker fetch failed", error);
      }
    }

    void load();
    const id = window.setInterval(() => {
      void load();
    }, refreshInterval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbols, fetchPrices, refreshInterval]);

  return { items, loading };
}

export function AppTickerBar({
  className,
  speed = 40,
  pauseOnHover = true
}: Pick<TickerBarProps, "className" | "speed" | "pauseOnHover">) {
  const symbols = useMemo(() => [...APP_TICKER_SYMBOLS], []);

  const fetchPrices = useCallback(async (requestedSymbols: string[]) => {
    const response = await fetch(`/api/price/live?symbols=${requestedSymbols.join(",")}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Ticker fetch failed with status ${response.status}`);
    }
    const payload = (await response.json()) as LiveQuotePayload;
    const rows = new Map(payload.quotes.map((quote) => [quote.symbol, quote]));
    return requestedSymbols
      .map((symbol) => normalizeTickerItem(rows.get(symbol) ?? null))
      .filter((item): item is TickerItem => item !== null);
  }, []);

  const { items } = useTickerData({
    symbols,
    fetchPrices
  });

  return <TickerBar items={items} speed={speed} pauseOnHover={pauseOnHover} className={className} />;
}
