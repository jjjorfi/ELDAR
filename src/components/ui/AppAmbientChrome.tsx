"use client";

import { useEffect, useMemo, useState } from "react";

import { LiveBreathingBackground } from "@/components/ui/BreathingBackground";
import { useDynamicFavicon, useLiveTitle } from "@/components/ui/BrowserChrome";
import { GrainOverlay } from "@/components/ui/GrainOverlay";
import { MarketStatusBar, useMarketState } from "@/components/ui/MarketStatusBar";

interface DashboardSnapshotItem {
  symbol: string;
  label: string;
  price: number | null;
  changePercent: number | null;
}

interface DashboardResponse {
  snapshot?: DashboardSnapshotItem[];
}

type ThemeMode = "dark" | "light";

function readThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function findSpxSnapshot(snapshot: DashboardSnapshotItem[] | undefined): DashboardSnapshotItem | undefined {
  if (!Array.isArray(snapshot)) return undefined;
  return snapshot.find((item) => item.label === "SPX" || item.symbol === "^GSPC");
}

export function AppAmbientChrome(): JSX.Element {
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [spxChange, setSpxChange] = useState<number | undefined>(undefined);
  const [spxPrice, setSpxPrice] = useState<number | undefined>(undefined);

  useEffect(() => {
    setThemeMode(readThemeMode());

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeMode(readThemeMode());
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadDashboardSnapshot = async (): Promise<void> => {
      try {
        const response = await fetch("/api/home/dashboard?sectorWindow=YTD", {
          cache: "no-store"
        });
        if (!response.ok) return;
        const payload = (await response.json()) as DashboardResponse;
        if (cancelled) return;
        const spxSnapshot = findSpxSnapshot(payload.snapshot);
        setSpxChange(typeof spxSnapshot?.changePercent === "number" ? spxSnapshot.changePercent : undefined);
        setSpxPrice(typeof spxSnapshot?.price === "number" ? spxSnapshot.price : undefined);
      } catch {
        // ambient chrome should never block the app shell
      }
    };

    void loadDashboardSnapshot();
    const interval = window.setInterval(() => {
      void loadDashboardSnapshot();
    }, 180_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const marketState = useMarketState(spxChange);
  useDynamicFavicon(spxChange ?? null);
  useLiveTitle({
    appName: "ELDAR",
    symbol: spxPrice !== undefined ? "SPX" : undefined,
    price: spxPrice
  });
  const grainOpacity = themeMode === "light" ? 0.024 : 0.035;
  const breathingOpacity = useMemo(() => {
    if (themeMode === "light") return 0.06;
    if (marketState === "bull" || marketState === "bear") return 0.1;
    return 0.12;
  }, [marketState, themeMode]);

  return (
    <>
      <LiveBreathingBackground marketState={marketState} opacity={breathingOpacity} />
      <MarketStatusBar state={marketState} />
      <GrainOverlay opacity={grainOpacity} />
    </>
  );
}
