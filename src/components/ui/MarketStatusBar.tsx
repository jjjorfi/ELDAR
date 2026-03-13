"use client";

import { useEffect, useState } from "react";

type MarketState = "bull" | "bear" | "neutral" | "closed" | "loading";

type MarketStatusBarProps = {
  state?: MarketState;
  change?: number;
  threshold?: number;
};

const gradients: Record<MarketState, string> = {
  bull: "linear-gradient(90deg, transparent 0%, #10b981 20%, #34d399 50%, #10b981 80%, transparent 100%)",
  bear: "linear-gradient(90deg, transparent 0%, #ef4444 20%, #f87171 50%, #ef4444 80%, transparent 100%)",
  neutral: "linear-gradient(90deg, transparent 0%, #6b7280 20%, #9ca3af 50%, #6b7280 80%, transparent 100%)",
  closed: "linear-gradient(90deg, transparent 0%, #4b5563 20%, #6b7280 50%, #4b5563 80%, transparent 100%)",
  loading: "linear-gradient(90deg, transparent 0%, #374151 20%, #4b5563 50%, #374151 80%, transparent 100%)"
};

const glows: Record<MarketState, string> = {
  bull: "0 0 12px 1px rgba(16, 185, 129, 0.4)",
  bear: "0 0 12px 1px rgba(239, 68, 68, 0.4)",
  neutral: "0 0 8px 1px rgba(107, 114, 128, 0.25)",
  closed: "0 0 6px 1px rgba(75, 85, 99, 0.2)",
  loading: "none"
};

const shimmerStyle = `
  @keyframes status-shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
`;

export function MarketStatusBar({
  state,
  change,
  threshold = 0.3
}: MarketStatusBarProps): JSX.Element {
  const [derived, setDerived] = useState<MarketState>("loading");

  useEffect(() => {
    if (state) {
      setDerived(state);
      return;
    }

    if (change === undefined) {
      setDerived("neutral");
      return;
    }

    if (change > threshold) {
      setDerived("bull");
      return;
    }

    if (change < -threshold) {
      setDerived("bear");
      return;
    }

    setDerived("neutral");
  }, [change, state, threshold]);

  const isLoading = derived === "loading";

  return (
    <>
      <style>{shimmerStyle}</style>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "1px",
          zIndex: 9998,
          background: isLoading
            ? "linear-gradient(90deg, transparent, #374151 30%, #6b7280 50%, #374151 70%, transparent)"
            : gradients[derived],
          backgroundSize: isLoading ? "200% auto" : "100%",
          boxShadow: glows[derived],
          animation: isLoading ? "status-shimmer 1.8s linear infinite" : undefined,
          transition: "background 1.2s ease, box-shadow 1.2s ease",
          pointerEvents: "none"
        }}
      />
    </>
  );
}

export function useMarketState(spyChangePercent: number | undefined): MarketState {
  if (spyChangePercent === undefined) return "loading";

  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const hours = et.getHours() + et.getMinutes() / 60;
  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = hours >= 9.5 && hours < 16;

  if (!isWeekday || !isMarketHours) return "closed";
  if (spyChangePercent > 0.3) return "bull";
  if (spyChangePercent < -0.3) return "bear";
  return "neutral";
}
