"use client";

import clsx from "clsx";
import { BriefcaseBusiness, BookText, Home, Layers, LineChart, Plus, Search, Share2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePopupWheelScroll } from "@/hooks/usePopupWheelScroll";
import { isPaletteOpenShortcut } from "@/lib/ui/command-palette";
import { getRecentTickers } from "@/lib/ui/recent-tickers";

const DASHBOARD_RETURN_STATE_KEY = "eldar:dashboard:return-state";

type PaletteItem = {
  id: string;
  title: string;
  subtitle: string;
  icon: JSX.Element;
  onSelect: () => void;
};

interface SearchSuggestion {
  symbol: string;
  companyName: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function stashDashboardIntent(
  view: "home" | "portfolio" | "watchlist",
  ticker = "",
  options?: {
    openPalette?: boolean;
    paletteAction?: "analyze" | "portfolio-add" | "compare-add" | "watchlist-add";
    autoAnalyze?: boolean;
  }
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      DASHBOARD_RETURN_STATE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        isAppOpen: true,
        view,
        ticker,
        openPalette: Boolean(options?.openPalette),
        paletteAction: options?.paletteAction ?? "analyze",
        autoAnalyze: Boolean(options?.autoAnalyze)
      })
    );
  } catch {
    // no-op
  }
}

export function GlobalCommandPalette(): JSX.Element | null {
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentTickers, setRecentTickers] = useState<string[]>([]);
  const [asyncSuggestions, setAsyncSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
    setAsyncSuggestions([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    setRecentTickers(getRecentTickers());
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isPaletteOpenShortcut(event)) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        setOpen(true);
        return;
      }

      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setAsyncSuggestions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/search?query=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: "no-store"
        });
        const payload = (await response.json()) as { suggestions?: SearchSuggestion[] };
        if (cancelled) return;
        setAsyncSuggestions(Array.isArray(payload.suggestions) ? payload.suggestions.slice(0, 8) : []);
      } catch {
        if (!cancelled) {
          setAsyncSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  const baseItems = useMemo<PaletteItem[]>(() => {
    const openDashboardPalette = (
      paletteAction: "analyze" | "portfolio-add" | "compare-add" | "watchlist-add",
      ticker = ""
    ): void => {
      stashDashboardIntent("home", ticker, { openPalette: true, paletteAction });
      router.push("/");
      close();
    };

    return [
      {
        id: "nav-home",
        title: "Go to Home",
        subtitle: "Dashboard and stock analysis",
        icon: <Home className="h-4 w-4" />,
        onSelect: () => {
          router.push("/");
          close();
        }
      },
      {
        id: "nav-portfolio",
        title: "Go to Portfolio",
        subtitle: "Open portfolio health checker",
        icon: <BriefcaseBusiness className="h-4 w-4" />,
        onSelect: () => {
          stashDashboardIntent("portfolio");
          router.push("/");
          close();
        }
      },
      {
        id: "nav-sectors",
        title: "Go to Sectors",
        subtitle: "Sector heatmap and sentiment",
        icon: <Layers className="h-4 w-4" />,
        onSelect: () => {
          router.push("/sectors");
          close();
        }
      },
      {
        id: "nav-journal",
        title: "Go to Journal",
        subtitle: "Investment log and reviews",
        icon: <BookText className="h-4 w-4" />,
        onSelect: () => {
          router.push("/journal");
          close();
        }
      },
      {
        id: "action-new-journal",
        title: "New Journal Entry",
        subtitle: "Create a fresh trade log",
        icon: <Plus className="h-4 w-4" />,
        onSelect: () => {
          router.push("/journal?create=1");
          close();
        }
      },
      {
        id: "action-share",
        title: "Share Card",
        subtitle: "Open dashboard share controls",
        icon: <Share2 className="h-4 w-4" />,
        onSelect: () => {
          stashDashboardIntent("home");
          router.push("/");
          close();
        }
      },
      {
        id: "action-watchlist",
        title: "Add to Watchlist",
        subtitle: "Open watchlist add action",
        icon: <Search className="h-4 w-4" />,
        onSelect: () => openDashboardPalette("watchlist-add")
      },
      {
        id: "action-portfolio",
        title: "Add to Portfolio",
        subtitle: "Open portfolio add action",
        icon: <LineChart className="h-4 w-4" />,
        onSelect: () => openDashboardPalette("portfolio-add")
      }
    ];
  }, [router, close]);

  const dynamicTickerItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    for (const recent of recentTickers) {
      items.push({
        id: `recent-${recent}`,
        title: recent,
        subtitle: "Recent ticker",
        icon: <Search className="h-4 w-4" />,
        onSelect: () => {
          stashDashboardIntent("home", recent, { autoAnalyze: true });
          router.push("/");
          close();
        }
      });
    }

    for (const result of asyncSuggestions) {
      items.push({
        id: `remote-${result.symbol}`,
        title: result.symbol,
        subtitle: result.companyName,
        icon: <Search className="h-4 w-4" />,
        onSelect: () => {
          stashDashboardIntent("home", result.symbol, { autoAnalyze: true });
          router.push("/");
          close();
        }
      });
    }

    return items;
  }, [recentTickers, asyncSuggestions, router, close]);

  const filteredBase = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return baseItems;
    return baseItems.filter((item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q));
  }, [baseItems, query]);

  const items = useMemo(() => {
    const merged = [...filteredBase, ...dynamicTickerItems];
    const deduped = new Map<string, PaletteItem>();
    for (const item of merged) {
      if (!deduped.has(item.id)) deduped.set(item.id, item);
    }
    return Array.from(deduped.values()).slice(0, 18);
  }, [filteredBase, dynamicTickerItems]);
  const handlePopupWheel = usePopupWheelScroll<HTMLDivElement>();

  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
  }, [items, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!open) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => (items.length === 0 ? 0 : (prev + 1) % items.length));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => (items.length === 0 ? 0 : (prev - 1 + items.length) % items.length));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selected = items[selectedIndex];
        selected?.onSelect();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, items, selectedIndex]);

  if (pathname === "/") {
    return null;
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-start justify-center bg-black/55 px-4 pt-[12vh]" role="presentation">
      <button type="button" aria-label="Close command palette" className="absolute inset-0" onClick={close} />
      <div role="dialog" aria-modal="true" aria-labelledby="global-palette-title" className="relative z-10 w-full max-w-2xl border border-white/15 bg-[#0a0a0a] p-4 texture-card rough-border">
        <div className="mb-3 flex items-center gap-3 border-b border-white/10 pb-3">
          <Search className="h-4 w-4 text-white/55" aria-hidden="true" />
          <label htmlFor="global-palette-input" id="global-palette-title" className="sr-only">
            Search and actions
          </label>
          <input
            id="global-palette-input"
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search ticker, navigate, or trigger action"
            className="w-full border-0 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
          />
          <span className="border border-white/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white/50">Esc</span>
        </div>

        <div onWheelCapture={handlePopupWheel} className="eldar-scrollbar max-h-[52vh] overflow-y-auto overscroll-contain" role="listbox" aria-label="Palette results">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs uppercase tracking-[0.12em] text-white/45">No matches</p>
          ) : (
            items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={item.onSelect}
                role="option"
                aria-selected={selectedIndex === index}
                className={clsx(
                  "flex w-full items-center gap-3 border-b border-white/10 px-2 py-3 text-left transition",
                  selectedIndex === index ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                )}
              >
                <span className="text-white/65">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white">{item.title}</span>
                  <span className="block truncate text-[11px] text-white/55">{item.subtitle}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-[10px] uppercase tracking-[0.12em] text-white/45">
          <span>{loading ? "Searching..." : "Cmd/Ctrl+K to open"}</span>
          <span>↑ ↓ Enter</span>
        </div>
      </div>
    </div>
  );
}
