"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BookText,
  BriefcaseBusiness,
  Home,
  Layers,
  LineChart,
  Plus,
  Search,
  TrendingUp,
  X
} from "lucide-react";

import { cn } from "@/lib/utils";
import { isPaletteOpenShortcut } from "@/lib/ui/command-palette";
import { stashDashboardIntent } from "@/lib/ui/dashboard-intent";
import { getRecentTickers } from "@/lib/ui/recent-tickers";

type Command = {
  id: string;
  label: string;
  description?: string;
  icon: ReactNode;
  action: () => void;
  keywords?: string;
};

interface SearchSuggestion {
  symbol: string;
  companyName: string;
}

function fuzzy(str: string, pattern: string): boolean {
  const normalizedPattern = pattern.toLowerCase();
  const normalizedText = str.toLowerCase();
  let patternIndex = 0;

  for (let index = 0; index < normalizedText.length && patternIndex < normalizedPattern.length; index += 1) {
    if (normalizedText[index] === normalizedPattern[patternIndex]) {
      patternIndex += 1;
    }
  }

  return patternIndex === normalizedPattern.length;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function GlobalCommandPalette(): JSX.Element | null {
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentTickers, setRecentTickers] = useState<string[]>([]);
  const [asyncSuggestions, setAsyncSuggestions] = useState<SearchSuggestion[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setAsyncSuggestions([]);
  }, []);

  const openDashboardHome = useCallback((ticker = "", paletteAction: "analyze" | "portfolio-add" | "watchlist-add" = "analyze"): void => {
    stashDashboardIntent("home", ticker, {
      openPalette: paletteAction !== "analyze",
      paletteAction,
      autoAnalyze: paletteAction === "analyze" && ticker.length > 0
    });
    router.push("/");
    close();
  }, [close, router]);

  const commands = useMemo<Command[]>(() => [
    {
      id: "dashboard",
      label: "Dashboard",
      description: "Overview and stock analysis",
      icon: <Home size={16} />,
      action: () => {
        router.push("/");
        close();
      },
      keywords: "home overview analysis"
    },
    {
      id: "portfolio",
      label: "Portfolio",
      description: "Holdings and allocation",
      icon: <BriefcaseBusiness size={16} />,
      action: () => {
        stashDashboardIntent("portfolio");
        router.push("/");
        close();
      },
      keywords: "holdings positions allocation"
    },
    {
      id: "macro",
      label: "Macro",
      description: "Regime and market context",
      icon: <TrendingUp size={16} />,
      action: () => {
        router.push("/macro");
        close();
      },
      keywords: "regime macro markets"
    },
    {
      id: "sectors",
      label: "Sectors",
      description: "Sector rotation and detail",
      icon: <Layers size={16} />,
      action: () => {
        router.push("/sectors");
        close();
      },
      keywords: "rotation heatmap sector"
    },
    {
      id: "journal",
      label: "Journal",
      description: "Research log and reviews",
      icon: <BookText size={16} />,
      action: () => {
        router.push("/journal");
        close();
      },
      keywords: "notes research trade log"
    },
    {
      id: "journal-new",
      label: "New Journal Entry",
      description: "Create a fresh note",
      icon: <Plus size={16} />,
      action: () => {
        router.push("/journal?create=1");
        close();
      },
      keywords: "create note entry"
    },
    {
      id: "watchlist-add",
      label: "Add to Watchlist",
      description: "Open the watchlist add action",
      icon: <Search size={16} />,
      action: () => openDashboardHome("", "watchlist-add"),
      keywords: "watchlist add ticker"
    },
    {
      id: "portfolio-add",
      label: "Add to Portfolio",
      description: "Open the portfolio add action",
      icon: <LineChart size={16} />,
      action: () => openDashboardHome("", "portfolio-add"),
      keywords: "portfolio add position"
    }
  ], [close, openDashboardHome, router]);

  const dynamicCommands = useMemo<Command[]>(() => {
    if (query.trim().length > 0) {
      return asyncSuggestions.map((result) => ({
        id: `ticker-${result.symbol}`,
        label: result.symbol,
        description: result.companyName,
        icon: <Search size={16} />,
        action: () => openDashboardHome(result.symbol, "analyze"),
        keywords: `${result.symbol} ${result.companyName}`
      }));
    }

    return recentTickers.map((ticker) => ({
      id: `recent-${ticker}`,
      label: ticker,
      description: "Recent ticker",
      icon: <Search size={16} />,
      action: () => openDashboardHome(ticker, "analyze"),
      keywords: `${ticker} recent`
    }));
  }, [asyncSuggestions, openDashboardHome, query, recentTickers]);

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    const pool = [...commands, ...dynamicCommands];
    const filteredPool = trimmed.length === 0
      ? pool
      : pool.filter((command) =>
          fuzzy(
            `${command.label} ${command.keywords ?? ""} ${command.description ?? ""}`,
            trimmed
          )
        );

    const deduped = new Map<string, Command>();
    for (const command of filteredPool) {
      if (!deduped.has(command.id)) {
        deduped.set(command.id, command);
      }
    }
    return Array.from(deduped.values());
  }, [commands, dynamicCommands, query]);

  const runCommand = useCallback((command: Command) => {
    command.action();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (isPaletteOpenShortcut(event)) {
        if (pathname === "/" || isTypingTarget(event.target)) return;
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }

      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, pathname]);

  useEffect(() => {
    if (!open) return;
    setRecentTickers(getRecentTickers());
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "Enter" && filtered[activeIndex]) {
        event.preventDefault();
        runCommand(filtered[activeIndex]);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeIndex, filtered, open, runCommand]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setAsyncSuggestions([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
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
      }
    }, 120);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  if (pathname === "/") {
    return null;
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-start justify-center pt-[20vh]" onClick={close}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-command-palette-title"
      >
        <div className="flex items-center gap-3 border-b border-white/8 px-4">
          <Search size={16} className="shrink-0 text-zinc-500" />
          <input
            id="global-command-palette-title"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent py-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <button type="button" onClick={close} className="text-zinc-600 transition-colors hover:text-zinc-400" aria-label="Close command palette">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-600">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  index === activeIndex
                    ? "bg-white/8 text-zinc-100"
                    : "text-zinc-400 hover:bg-white/4 hover:text-zinc-200"
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
              >
                <span className={index === activeIndex ? "text-zinc-300" : "text-zinc-600"}>{command.icon}</span>
                <span className="flex-1 text-sm">{command.label}</span>
                {command.description ? (
                  <span className="text-xs text-zinc-600">{command.description}</span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="flex gap-4 border-t border-white/8 px-4 py-2.5 text-xs text-zinc-600">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export { GlobalCommandPalette as CommandPalette };
