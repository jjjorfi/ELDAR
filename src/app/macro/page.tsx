"use client";

import clsx from "clsx";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BriefcaseBusiness, CircleUserRound, Grid2x2, Home, LineChart, Moon, Search, Sun } from "lucide-react";
import { useRouter } from "next/navigation";

const RSS_TICKER_ID = "_TY28wH8o2RkP29Ic";
const RSS_PARKING_ID = "eldar-rss-parking";
const ELDAR_BRAND_LOGO = "/brand/eldar-logo.png";
const DASHBOARD_RETURN_STATE_KEY = "eldar:dashboard:return-state";

interface MacroIndicatorSnapshot {
  key: string;
  title: string;
  seriesId: string;
  unit: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  value: number | null;
  date: string | null;
  change: number | null;
  changeMode: "yoy_pct" | "qoq_pct" | "mom_pct" | "delta_pp" | "delta_abs";
}

function ensureRssParkingNode(): HTMLDivElement {
  const existing = document.getElementById(RSS_PARKING_ID);
  if (existing && existing instanceof HTMLDivElement) {
    return existing;
  }

  const parking = document.createElement("div");
  parking.id = RSS_PARKING_ID;
  parking.style.position = "fixed";
  parking.style.left = "-99999px";
  parking.style.top = "0";
  parking.style.width = "1px";
  parking.style.height = "1px";
  parking.style.overflow = "hidden";
  parking.style.pointerEvents = "none";
  parking.style.opacity = "0";
  document.body.appendChild(parking);
  return parking;
}

function ensureRssTickerElement(): HTMLElement {
  const parking = ensureRssParkingNode();
  const existing = document.querySelector(`rssapp-ticker[data-eldar-rss="1"]`);
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const ticker = document.createElement("rssapp-ticker");
  ticker.setAttribute("id", RSS_TICKER_ID);
  ticker.setAttribute("data-eldar-rss", "1");
  parking.appendChild(ticker);
  return ticker;
}

function NewsTickerBar(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const ticker = ensureRssTickerElement();
    if (ticker.parentElement !== host) {
      host.appendChild(ticker);
    }

    return () => {
      const parking = ensureRssParkingNode();
      if (ticker.parentElement !== parking) {
        parking.appendChild(ticker);
      }
    };
  }, []);

  return (
    <div className="relative hidden flex-1 items-center px-2 md:flex">
      <div className="eldar-rss-shell w-full [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div ref={hostRef} className="min-h-[24px]" />
      </div>
    </div>
  );
}

function formatValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (unit === "Index") return value.toFixed(2);
  if (unit === "Thousands") return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (unit.includes("Billions")) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (unit.includes("Millions")) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatChange(value: number | null, mode: MacroIndicatorSnapshot["changeMode"]): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (mode === "delta_abs") return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (mode === "delta_pp") return `${value > 0 ? "+" : ""}${value.toFixed(2)} pp`;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function changeTone(value: number | null): "positive" | "neutral" | "negative" {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function XBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.039 9.19L24 22.847h-7.406l-5.8-7.584-6.64 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zM17.61 20.644h2.039L6.486 3.24H4.298z" />
    </svg>
  );
}

function TelegramBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.62 8.17-1.95 9.19c-.15.65-.54.81-1.09.5l-3.02-2.23-1.46 1.41c-.16.16-.3.3-.62.3l.22-3.11 5.66-5.11c.25-.22-.05-.34-.38-.12l-7 4.41-3.02-.94c-.66-.2-.67-.66.14-.97l11.79-4.55c.55-.2 1.03.13.85.93z" />
    </svg>
  );
}

export default function MacroPage(): JSX.Element {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [indicators, setIndicators] = useState<MacroIndicatorSnapshot[]>([]);

  function openDashboardView(
    view: "home" | "portfolio" | "watchlist",
    ticker?: string,
    options?: { openPalette?: boolean; paletteAction?: "analyze" | "portfolio-add" | "compare-add" }
  ): void {
    try {
      const payload = {
        savedAt: Date.now(),
        isAppOpen: true,
        view,
        ticker: ticker?.trim().toUpperCase() ?? "",
        openPalette: Boolean(options?.openPalette),
        paletteAction: options?.paletteAction ?? "analyze"
      };
      window.sessionStorage.setItem(DASHBOARD_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch {
      // no-op
    }

    router.push("/");
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("eldar-theme-mode");
      const mode = saved === "light" ? "light" : "dark";
      setThemeMode(mode);
      document.documentElement.dataset.theme = mode;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem("eldar-theme-mode", themeMode);
    } catch {
      // no-op
    }
  }, [themeMode]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent): void => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    const refreshMarketStatus = (): void => {
      const now = new Date();
      const day = now.getDay();
      const hour = now.getHours();
      const minutes = now.getMinutes();
      const open = day >= 1 && day <= 5 && (hour > 9 || (hour === 9 && minutes >= 30)) && hour < 16;
      setIsMarketOpen(open);
    };

    refreshMarketStatus();
    const interval = window.setInterval(refreshMarketStatus, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadMacro = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");
        const response = await fetch("/api/macro/fred");
        const payload = (await response.json()) as { indicators?: MacroIndicatorSnapshot[]; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load macro indicators.");
        }
        setIndicators(Array.isArray(payload.indicators) ? payload.indicators : []);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load macro indicators.");
          setIndicators([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadMacro();
    const interval = window.setInterval(() => {
      void loadMacro();
    }, 180_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const macroSummary = useMemo(() => {
    const valid = indicators.filter((item) => item.value !== null);
    if (valid.length === 0) {
      return {
        available: 0,
        total: indicators.length
      };
    }
    return {
      available: valid.length,
      total: indicators.length
    };
  }, [indicators]);

  return (
    <main className="min-h-screen overflow-x-hidden text-white" style={{ background: "#111317" }}>
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        <div className="container mx-auto px-6">
          <div className="flex h-16 items-center justify-between gap-3">
            <button type="button" onClick={() => openDashboardView("home")} className="flex cursor-pointer items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden">
                <Image src={ELDAR_BRAND_LOGO} alt="ELDAR logo" fill sizes="40px" className="object-contain" priority />
              </div>
            </button>
            <NewsTickerBar />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openDashboardView("home", "", { openPalette: true, paletteAction: "analyze" })}
                title="Search"
                aria-label="Search"
                className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border text-slate-900 transition-all backdrop-blur-xl"
              >
                <Search className="h-4 w-4" />
              </button>

              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setIsMenuOpen((prev) => !prev)}
                  className={clsx(
                    "flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold transition-all backdrop-blur-xl",
                    isMenuOpen ? "eldar-btn-ghost border-white/60 bg-white/10 text-white" : "eldar-btn-silver text-slate-900"
                  )}
                  title="Menu"
                  aria-label="Menu"
                >
                  <Grid2x2 className="h-4 w-4" />
                </button>
                {isMenuOpen ? (
                  <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-2xl border border-white/20 bg-zinc-950/90 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        openDashboardView("home");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <Home className="h-4 w-4" />
                      Home
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        router.push("/sectors");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <Grid2x2 className="h-4 w-4" />
                      Sectors
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white transition hover:bg-white/10"
                    >
                      <LineChart className="h-4 w-4" />
                      Macro
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        openDashboardView("portfolio");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <BriefcaseBusiness className="h-4 w-4" />
                      Portfolio
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => openDashboardView("watchlist")}
                className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border text-slate-900 transition-all backdrop-blur-xl"
                title="Watchlist"
                aria-label="Watchlist"
              >
                <Bookmark className="h-4 w-4" />
              </button>
              <SignedOut>
                <SignInButton mode="modal">
                  <button
                    type="button"
                    className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border text-slate-900 transition-all backdrop-blur-xl"
                    title="Profile"
                    aria-label="Profile"
                  >
                    <CircleUserRound className="h-4 w-4" />
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/30 bg-black/20 p-0.5 backdrop-blur-xl">
                  <UserButton afterSignOutUrl="/" />
                </div>
              </SignedIn>
            </div>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-6 pb-20 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="eldar-display text-2xl font-bold tracking-[0.14em] text-white md:text-3xl">MACRO</h1>
          </div>

          {error ? (
            <div className="mb-6 rounded-2xl border border-zinc-400/35 bg-zinc-300/10 px-4 py-3 text-sm text-zinc-100">{error}</div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {indicators.slice(0, 4).map((item) => {
              const tone = changeTone(item.change);
              return (
                <div key={`macro-top-${item.key}`} className="eldar-panel rounded-2xl p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/55">{item.title}</p>
                  <p className="mt-2 text-2xl font-bold text-white">{formatValue(item.value, item.unit)}</p>
                  <p
                    className={clsx(
                      "mt-2 text-sm",
                      tone === "positive" && "text-emerald-300",
                      tone === "negative" && "text-red-300",
                      tone === "neutral" && "text-white/70"
                    )}
                  >
                    {formatChange(item.change, item.changeMode)}
                  </p>
                  <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-white/50">{item.frequency} • {item.seriesId}</p>
                </div>
              );
            })}
          </div>

          <div className="eldar-panel mt-6 overflow-hidden rounded-3xl">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-white/15 bg-white/[0.04]">
                  <tr className="text-left text-xs uppercase tracking-[0.14em] text-white/70">
                    <th className="px-4 py-3">Indicator</th>
                    <th className="px-4 py-3">Latest</th>
                    <th className="px-4 py-3">Move</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Series</th>
                    <th className="px-4 py-3">As Of</th>
                  </tr>
                </thead>
                <tbody>
                  {indicators.map((item) => {
                    const tone = changeTone(item.change);
                    return (
                      <tr key={item.key} className="border-b border-white/10 text-sm text-white/90">
                        <td className="px-4 py-3 font-semibold">{item.title}</td>
                        <td className="px-4 py-3 font-mono text-white/85">{formatValue(item.value, item.unit)}</td>
                        <td
                          className={clsx(
                            "px-4 py-3 font-mono",
                            tone === "positive" && "text-emerald-300",
                            tone === "negative" && "text-red-300",
                            tone === "neutral" && "text-white/75"
                          )}
                        >
                          {formatChange(item.change, item.changeMode)}
                        </td>
                        <td className="px-4 py-3 text-white/70">{item.frequency}</td>
                        <td className="px-4 py-3 font-mono text-white/70">{item.seriesId}</td>
                        <td className="px-4 py-3 text-white/70">{item.date ?? "N/A"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        <div className="container mx-auto px-6">
          <div className="flex h-10 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="eldar-status-star eldar-status-live" />
              <span className="eldar-caption text-[9px] text-white/50">LIVE | {isMarketOpen ? "Market Open" : "Market Closed"}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
                className={clsx(
                  "eldar-theme-toggle rounded-lg border p-1.5 transition",
                  themeMode === "dark"
                    ? "border-amber-300/45 bg-amber-200/10 text-[#F5C451] hover:border-amber-200/75 hover:bg-amber-200/18"
                    : "border-sky-200/45 bg-sky-100/12 text-[#BCD4FF] hover:border-sky-100/75 hover:bg-sky-100/22"
                )}
                aria-label="Toggle theme"
                title="Toggle theme"
              >
                {themeMode === "dark" ? <Sun className="eldar-theme-glyph h-3.5 w-3.5" /> : <Moon className="eldar-theme-glyph h-3.5 w-3.5" />}
              </button>
              <a
                href="https://x.com/ELDAR_AI?s=20"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/80 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                aria-label="X"
                title="X"
              >
                <XBrandIcon />
              </a>
              <a
                href="https://t.me"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/80 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                aria-label="Telegram"
                title="Telegram"
              >
                <TelegramBrandIcon />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
