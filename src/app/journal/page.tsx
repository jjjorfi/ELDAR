"use client";

import clsx from "clsx";
import { SignInButton, SignedIn, SignedOut, UserButton, useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookText, Bookmark, BriefcaseBusiness, CircleUserRound, Grid2x2, Home, LineChart, Lock, Plus, Search, Trash2, X } from "lucide-react";

import type { JournalEntry, JournalReviewStats, SetupQuality, TradeStatus } from "@/lib/journal/types";

const ELDAR_BRAND_LOGO = "/brand/eldar-logo.png";
const DASHBOARD_RETURN_STATE_KEY = "eldar:dashboard:return-state";

type JournalTab = "active" | "closed" | "review";
type ClosedSortKey = "createdAt" | "returnPct" | "setupQuality";

interface NewTradePayload {
  ticker: string;
  thesis: string;
}

interface SearchCandidate {
  symbol: string;
  companyName: string;
}

const DEFAULT_REVIEW: JournalReviewStats = {
  winRate: null,
  avgWinner: null,
  avgLoser: null,
  bestSetup: null,
  worstHabit: null,
  avgEldarOnWinners: null,
  avgEldarOnLosers: null,
  mostUsedTags: [],
  bestTags: []
};

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function statusTone(status: TradeStatus): string {
  if (status === "PLANNING") return "border-[#EAB308] text-[#EAB308]";
  if (status === "OPEN") return "border-[#22C55E] text-[#22C55E]";
  return "border-[#555] text-[#999]";
}

function setupTone(quality: SetupQuality): string {
  if (quality === "A") return "text-[#22C55E]";
  if (quality === "B") return "text-[#EAB308]";
  return "text-[#EF4444]";
}

function ratingTone(rating: JournalEntry["eldarSnapshot"]["rating"]): string {
  if (rating === "STRONG_BUY" || rating === "BUY") return "text-[#22C55E]";
  if (rating === "HOLD") return "text-[#999]";
  return "text-[#EF4444]";
}

function toNumberOrNull(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function riskReward(entry: JournalEntry): number | null {
  if (entry.entryPrice === null || entry.targetPrice === null || entry.stopLoss === null) return null;
  const reward = entry.targetPrice - entry.entryPrice;
  const risk = entry.entryPrice - entry.stopLoss;
  if (risk <= 0) return null;
  return reward / risk;
}

function computeLiveReturn(entry: JournalEntry): number | null {
  if (entry.entryPrice === null || entry.exitPrice === null || entry.entryPrice <= 0) return null;
  return ((entry.exitPrice - entry.entryPrice) / entry.entryPrice) * 100;
}

function sortClosedEntries(entries: JournalEntry[], key: ClosedSortKey, direction: "asc" | "desc"): JournalEntry[] {
  const sign = direction === "asc" ? 1 : -1;
  const rank: Record<SetupQuality, number> = { A: 3, B: 2, C: 1 };
  return [...entries].sort((left, right) => {
    if (key === "returnPct") {
      const leftValue = left.returnPct ?? -Infinity;
      const rightValue = right.returnPct ?? -Infinity;
      return (leftValue - rightValue) * sign;
    }
    if (key === "setupQuality") {
      return (rank[left.setupQuality] - rank[right.setupQuality]) * sign;
    }
    return (Date.parse(left.createdAt) - Date.parse(right.createdAt)) * sign;
  });
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-white/12 bg-zinc-950/45 p-4">
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

export default function JournalPage(): JSX.Element {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { isSignedIn } = useAuth();

  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [tab, setTab] = useState<JournalTab>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<ClosedSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [review, setReview] = useState<JournalReviewStats>(DEFAULT_REVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<JournalEntry | null>(null);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [newTradeOpen, setNewTradeOpen] = useState(false);
  const [newTradeTicker, setNewTradeTicker] = useState("");
  const [newTradeThesis, setNewTradeThesis] = useState("");
  const [newTradeLoading, setNewTradeLoading] = useState(false);
  const [newTradeError, setNewTradeError] = useState("");
  const [newTradeSearchLoading, setNewTradeSearchLoading] = useState(false);
  const [newTradeCandidates, setNewTradeCandidates] = useState<SearchCandidate[]>([]);
  const [tagInput, setTagInput] = useState("");

  function openDashboardView(
    view: "home" | "portfolio" | "watchlist",
    ticker?: string,
    options?: {
      openPalette?: boolean;
      paletteAction?: "analyze" | "portfolio-add" | "compare-add" | "watchlist-add";
      autoAnalyze?: boolean;
    }
  ): void {
    try {
      const payload = {
        savedAt: Date.now(),
        isAppOpen: true,
        view,
        ticker: ticker?.trim().toUpperCase() ?? "",
        openPalette: Boolean(options?.openPalette),
        paletteAction: options?.paletteAction ?? "analyze",
        autoAnalyze: Boolean(options?.autoAnalyze)
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

  const loadEntries = async (): Promise<void> => {
    if (!isSignedIn) {
      setEntries([]);
      setReview(DEFAULT_REVIEW);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/journal/entries?limit=500", { cache: "no-store" });
      const payload = (await response.json()) as { items?: JournalEntry[]; review?: JournalReviewStats; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load journal.");
      }
      setEntries(Array.isArray(payload.items) ? payload.items : []);
      setReview(payload.review ?? DEFAULT_REVIEW);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load journal.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedId(null);
      setDraft(null);
      return;
    }

    if (!selectedId) return;
    const match = entries.find((entry) => entry.id === selectedId);
    if (!match) {
      setSelectedId(null);
      setDraft(null);
      return;
    }
    setDraft(match);
  }, [entries, selectedId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticker = normalizeTicker(params.get("symbol") ?? "");
    const entryId = params.get("entryId");
    if (ticker) {
      setNewTradeTicker(ticker);
    }
    if (entryId) {
      setSelectedId(entryId);
    }
  }, []);

  useEffect(() => {
    if (!newTradeOpen) {
      setNewTradeCandidates([]);
      setNewTradeSearchLoading(false);
      return;
    }

    const query = newTradeTicker.trim();
    if (query.length < 1) {
      setNewTradeCandidates([]);
      setNewTradeSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        setNewTradeSearchLoading(true);
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=8`, { cache: "no-store" });
        const payload = (await response.json()) as {
          results?: Array<{ symbol: string; companyName: string }>;
        };
        if (cancelled) return;
        const candidates = Array.isArray(payload.results)
          ? payload.results
              .filter((item) => typeof item.symbol === "string" && typeof item.companyName === "string")
              .map((item) => ({ symbol: item.symbol, companyName: item.companyName }))
          : [];
        setNewTradeCandidates(candidates);
      } catch {
        if (!cancelled) {
          setNewTradeCandidates([]);
        }
      } finally {
        if (!cancelled) {
          setNewTradeSearchLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [newTradeOpen, newTradeTicker]);

  const tagSuggestions = useMemo(() => {
    const all = new Set<string>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        all.add(tag);
      }
    }
    return [...all].sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      [
        entry.ticker,
        entry.thesis,
        entry.technicalSetup,
        entry.fundamentalNote,
        entry.marketContext,
        entry.executionNotes,
        entry.whatWentRight,
        entry.whatWentWrong,
        ...entry.tags
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [entries, searchQuery]);

  const activeTrades = useMemo(
    () => filteredEntries.filter((entry) => entry.status === "PLANNING" || entry.status === "OPEN"),
    [filteredEntries]
  );
  const closedTrades = useMemo(
    () => sortClosedEntries(filteredEntries.filter((entry) => entry.status === "CLOSED"), sortKey, sortDirection),
    [filteredEntries, sortKey, sortDirection]
  );

  const closeDrawer = (): void => {
    setSelectedId(null);
    setDraft(null);
    setTagInput("");
  };

  const selectEntry = (entry: JournalEntry): void => {
    setSelectedId(entry.id);
    setDraft(entry);
    setTagInput("");
  };

  const createTrade = async (payload: NewTradePayload): Promise<void> => {
    try {
      setNewTradeLoading(true);
      setNewTradeError("");
      const response = await fetch("/api/journal/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json()) as { entry?: JournalEntry; error?: string };
      if (!response.ok || !body.entry) {
        throw new Error(body.error ?? "Failed to create trade entry.");
      }
      await loadEntries();
      selectEntry(body.entry);
      setNewTradeOpen(false);
      setNewTradeTicker("");
      setNewTradeThesis("");
      setNewTradeCandidates([]);
      setTab("active");
    } catch (createError) {
      setNewTradeError(createError instanceof Error ? createError.message : "Failed to create trade entry.");
    } finally {
      setNewTradeLoading(false);
    }
  };

  const saveDraft = async (): Promise<void> => {
    if (!draft) return;
    try {
      setDrawerSaving(true);
      const response = await fetch(`/api/journal/entries/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thesis: draft.thesis,
          technicalSetup: draft.technicalSetup,
          fundamentalNote: draft.fundamentalNote,
          marketContext: draft.marketContext,
          setupQuality: draft.setupQuality,
          entryPrice: draft.entryPrice,
          targetPrice: draft.targetPrice,
          stopLoss: draft.stopLoss,
          positionSizePct: draft.positionSizePct,
          followedPlan: draft.followedPlan,
          executionNotes: draft.executionNotes,
          exitPrice: draft.exitPrice,
          exitDate: draft.exitDate,
          whatWentRight: draft.whatWentRight,
          whatWentWrong: draft.whatWentWrong,
          wouldDoAgain: draft.wouldDoAgain,
          tags: draft.tags
        })
      });
      const payload = (await response.json()) as { entry?: JournalEntry; error?: string };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error ?? "Failed to save trade.");
      }
      await loadEntries();
      selectEntry(payload.entry);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save trade.");
    } finally {
      setDrawerSaving(false);
    }
  };

  const transitionStatus = async (status: TradeStatus): Promise<void> => {
    if (!draft) return;
    try {
      setStatusLoading(true);
      setError("");
      const response = await fetch(`/api/journal/entries/${draft.id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const payload = (await response.json()) as { entry?: JournalEntry; error?: string };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error ?? "Failed to update trade status.");
      }
      await loadEntries();
      selectEntry(payload.entry);
      if (status === "CLOSED") {
        setTab("closed");
      }
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Failed to update trade status.");
    } finally {
      setStatusLoading(false);
    }
  };

  const deleteEntry = async (): Promise<void> => {
    if (!draft) return;
    try {
      setDrawerSaving(true);
      const response = await fetch(`/api/journal/entries/${draft.id}`, { method: "DELETE" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to delete entry.");
      }
      closeDrawer();
      await loadEntries();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete entry.");
    } finally {
      setDrawerSaving(false);
    }
  };

  const renderTabs = (): JSX.Element => (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {[
        { key: "active", label: "Active Trades" },
        { key: "closed", label: "Closed Trades" },
        { key: "review", label: "Review" }
      ].map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => setTab(item.key as JournalTab)}
          className={clsx(
            "h-11 rounded-xl border px-4 text-xs font-semibold uppercase tracking-[0.12em] transition",
            tab === item.key
              ? "border-white/50 bg-white/10 text-white"
              : "border-white/18 bg-zinc-950/45 text-white/75 hover:border-white/30 hover:text-white"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  const renderActiveTrades = (): JSX.Element => (
    <div className="space-y-3">
      {activeTrades.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => selectEntry(entry)}
          className={clsx(
            "w-full rounded-2xl border bg-zinc-950/45 px-5 py-4 text-left transition",
            selectedId === entry.id ? "border-white/35" : "border-white/15 hover:border-white/30"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-lg font-semibold text-white">{entry.ticker}</p>
              <p className={clsx("mt-1 text-xs font-semibold uppercase tracking-[0.12em]", ratingTone(entry.eldarSnapshot.rating))}>
                Score {entry.eldarSnapshot.score.toFixed(1)} · {entry.eldarSnapshot.rating}
              </p>
            </div>
            <div className="text-right">
              <span className={clsx("inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]", statusTone(entry.status))}>
                {entry.status}
              </span>
              <p className="mt-2 text-xs text-white/60">Added {new Date(entry.createdAt).toLocaleDateString()}</p>
              {entry.status === "OPEN" && entry.entryPrice !== null ? (
                <p className="text-xs text-white/70">Entered @ ${entry.entryPrice.toFixed(2)}</p>
              ) : null}
            </div>
          </div>
          <p className="mt-3 truncate text-sm text-white/80">{entry.thesis}</p>
        </button>
      ))}
      {activeTrades.length === 0 ? (
        <div className="rounded-2xl border border-white/15 bg-zinc-950/45 px-6 py-16 text-center text-sm text-white/70">
          No active trades yet. Create your first planning entry.
        </div>
      ) : null}
    </div>
  );

  const renderClosedTrades = (): JSX.Element => (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3">
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as ClosedSortKey)}
          className="h-11 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
        >
          <option value="createdAt">Sort by date</option>
          <option value="returnPct">Sort by return</option>
          <option value="setupQuality">Sort by setup quality</option>
        </select>
        <select
          value={sortDirection}
          onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}
          className="h-11 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>
      {closedTrades.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => selectEntry(entry)}
          className={clsx(
            "w-full rounded-2xl border bg-zinc-950/45 px-5 py-4 text-left transition",
            selectedId === entry.id ? "border-white/35" : "border-white/15 hover:border-white/30"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-lg font-semibold text-white">{entry.ticker}</p>
              <p className="mt-1 text-xs text-white/60">CLOSED · {new Date(entry.updatedAt).toLocaleDateString()}</p>
            </div>
            <div className="text-right">
              <p className={clsx("text-base font-semibold", (entry.returnPct ?? 0) >= 0 ? "text-[#22C55E]" : "text-[#EF4444]")}>
                {formatPct(entry.returnPct)}
              </p>
              <p className="text-xs text-white/65">{entry.daysHeld ?? "N/A"} days</p>
              <p className={clsx("text-xs font-semibold", setupTone(entry.setupQuality))}>{entry.setupQuality}-setup</p>
            </div>
          </div>
        </button>
      ))}
      {closedTrades.length === 0 ? (
        <div className="rounded-2xl border border-white/15 bg-zinc-950/45 px-6 py-16 text-center text-sm text-white/70">
          No closed trades yet.
        </div>
      ) : null}
    </div>
  );

  const renderReview = (): JSX.Element => (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Win rate" value={review.winRate !== null ? `${review.winRate.toFixed(1)}%` : "N/A"} />
        <StatCard label="Avg winner" value={formatPct(review.avgWinner)} />
        <StatCard label="Avg loser" value={formatPct(review.avgLoser)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <StatCard
          label="Best setup"
          value={review.bestSetup ? `${review.bestSetup.quality}-setup · ${review.bestSetup.winRate?.toFixed(1) ?? "N/A"}% win` : "N/A"}
        />
        <StatCard
          label="Worst habit"
          value={review.worstHabit ? `${review.worstHabit.tag} · ${review.worstHabit.count}x` : "N/A"}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <StatCard
          label="Avg ELDAR score"
          value={`Winners ${review.avgEldarOnWinners?.toFixed(1) ?? "N/A"} / Losers ${review.avgEldarOnLosers?.toFixed(1) ?? "N/A"}`}
        />
      </div>

      <div className="rounded-2xl border border-white/12 bg-zinc-950/45 p-4">
        <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Most used tags</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {review.mostUsedTags.length > 0 ? (
            review.mostUsedTags.map((item) => (
              <span key={`tag-used-${item.tag}`} className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/80">
                {item.tag} ({item.count})
              </span>
            ))
          ) : (
            <span className="text-sm text-white/65">No tag history yet.</span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/12 bg-zinc-950/45 p-4">
        <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Best performing tags</p>
        <div className="mt-3 space-y-1.5">
          {review.bestTags.length > 0 ? (
            review.bestTags.map((item) => (
              <p key={`tag-best-${item.tag}`} className="text-sm text-white/80">
                {item.tag} → <span className={clsx((item.avgReturn ?? 0) >= 0 ? "text-[#22C55E]" : "text-[#EF4444]")}>{formatPct(item.avgReturn)}</span>
              </p>
            ))
          ) : (
            <p className="text-sm text-white/65">No performance-tag patterns yet.</p>
          )}
        </div>
      </div>
    </div>
  );

  const renderDrawer = (): JSX.Element | null => {
    if (!draft) return null;

    const closed = draft.status === "CLOSED";
    const rr = riskReward(draft);

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
        <div className="h-full w-full max-w-3xl overflow-y-auto border border-white/15 bg-black md:h-auto md:max-h-[88vh]">
          <div className="sticky top-0 z-10 border-b border-white/12 bg-black/95 px-5 py-4 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xl font-bold text-white">{draft.ticker}</p>
                  <Lock className="h-3.5 w-3.5 text-white/45" />
                </div>
                <p className={clsx("mt-1 text-xs uppercase tracking-[0.1em]", ratingTone(draft.eldarSnapshot.rating))}>
                  {draft.eldarSnapshot.rating} · {draft.eldarSnapshot.score.toFixed(1)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/70 transition hover:border-white/35 hover:text-white"
                aria-label="Close drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-5 px-5 py-5">
            <section className={clsx("rounded-2xl border border-white/12 bg-zinc-950/45 p-4", closed && "opacity-35")}>
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Decision</p>
              <textarea
                value={draft.thesis}
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, thesis: event.target.value } : prev))}
                disabled={closed}
                placeholder="One sentence thesis"
                className="mt-3 min-h-[90px] w-full rounded-xl border border-white/15 bg-zinc-950/55 px-3 py-2 text-sm text-white outline-none disabled:cursor-not-allowed"
              />
            </section>

            <section className={clsx("rounded-2xl border border-white/12 bg-zinc-950/45 p-4", closed && "opacity-35")}>
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Setup</p>
              <textarea
                value={draft.technicalSetup}
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, technicalSetup: event.target.value } : prev))}
                disabled={closed}
                placeholder="Technical setup"
                className="mt-3 min-h-[80px] w-full rounded-xl border border-white/15 bg-zinc-950/55 px-3 py-2 text-sm text-white outline-none disabled:cursor-not-allowed"
              />
              <textarea
                value={draft.fundamentalNote}
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, fundamentalNote: event.target.value } : prev))}
                disabled={closed}
                placeholder="Fundamental note"
                className="mt-3 min-h-[80px] w-full rounded-xl border border-white/15 bg-zinc-950/55 px-3 py-2 text-sm text-white outline-none disabled:cursor-not-allowed"
              />
              <textarea
                value={draft.marketContext}
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, marketContext: event.target.value } : prev))}
                disabled={closed}
                placeholder="Market context"
                className="mt-3 min-h-[80px] w-full rounded-xl border border-white/15 bg-zinc-950/55 px-3 py-2 text-sm text-white outline-none disabled:cursor-not-allowed"
              />
              <div className="mt-3 flex gap-2">
                {(["A", "B", "C"] as SetupQuality[]).map((quality) => (
                  <button
                    key={`quality-${quality}`}
                    type="button"
                    disabled={closed}
                    onClick={() => setDraft((prev) => (prev ? { ...prev, setupQuality: quality } : prev))}
                    className={clsx(
                      "h-9 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed",
                      draft.setupQuality === quality
                        ? "border-white/45 bg-white/15 text-white"
                        : "border-white/20 bg-white/5 text-white/75",
                      setupTone(quality)
                    )}
                  >
                    {quality}
                  </button>
                ))}
              </div>
            </section>

            <section className={clsx("rounded-2xl border border-white/12 bg-zinc-950/45 p-4", closed && "opacity-35")}>
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Plan</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  value={draft.entryPrice ?? ""}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, entryPrice: toNumberOrNull(event.target.value) } : prev))}
                  disabled={closed}
                  placeholder="Entry"
                  className="h-10 rounded-xl border border-white/15 bg-zinc-950/55 px-3 text-sm text-white outline-none disabled:cursor-not-allowed"
                />
                <input
                  value={draft.targetPrice ?? ""}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, targetPrice: toNumberOrNull(event.target.value) } : prev))}
                  disabled={closed}
                  placeholder="Target"
                  className="h-10 rounded-xl border border-white/15 bg-zinc-950/55 px-3 text-sm text-white outline-none disabled:cursor-not-allowed"
                />
                <input
                  value={draft.stopLoss ?? ""}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, stopLoss: toNumberOrNull(event.target.value) } : prev))}
                  disabled={closed}
                  placeholder="Stop"
                  className="h-10 rounded-xl border border-white/15 bg-zinc-950/55 px-3 text-sm text-white outline-none disabled:cursor-not-allowed"
                />
                <input
                  value={draft.positionSizePct ?? ""}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, positionSizePct: toNumberOrNull(event.target.value) } : prev))}
                  disabled={closed}
                  placeholder="Size %"
                  className="h-10 rounded-xl border border-white/15 bg-zinc-950/55 px-3 text-sm text-white outline-none disabled:cursor-not-allowed"
                />
              </div>
              <p className="mt-3 text-xs text-white/70">
                Risk/reward: {rr !== null && Number.isFinite(rr) ? `${rr.toFixed(2)} : 1` : "N/A"}
              </p>
            </section>

            <section
              className={clsx(
                "rounded-2xl border border-white/12 bg-zinc-950/45 p-4",
                !closed && "pointer-events-none opacity-35 border-dashed"
              )}
            >
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Execution</p>
              {!closed ? <p className="mt-2 text-xs text-white/70">Unlock when you close this trade.</p> : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDraft((prev) => (prev ? { ...prev, followedPlan: true } : prev))}
                  className={clsx(
                    "h-9 rounded-lg border px-3 text-sm font-semibold transition",
                    draft.followedPlan === true ? "border-white/45 bg-white/15 text-white" : "border-white/20 bg-white/5 text-white/75"
                  )}
                >
                  Followed plan: Yes
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((prev) => (prev ? { ...prev, followedPlan: false } : prev))}
                  className={clsx(
                    "h-9 rounded-lg border px-3 text-sm font-semibold transition",
                    draft.followedPlan === false ? "border-white/45 bg-white/15 text-white" : "border-white/20 bg-white/5 text-white/75"
                  )}
                >
                  No
                </button>
              </div>
              <textarea
                value={draft.executionNotes}
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, executionNotes: event.target.value } : prev))}
                placeholder="Execution notes"
                className="mt-3 min-h-[80px] w-full rounded-xl border border-white/15 bg-zinc-950/55 px-3 py-2 text-sm text-white outline-none"
              />
            </section>

            <section
              className={clsx(
                "rounded-2xl border border-white/12 bg-zinc-950/45 p-4",
                !closed && "pointer-events-none opacity-35 border-dashed"
              )}
            >
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Outcome</p>
              {!closed ? <p className="mt-2 text-xs text-white/70">Unlock when you close this trade.</p> : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  value={draft.exitPrice ?? ""}
                  onChange={(event) => setDraft((prev) => (prev ? { ...prev, exitPrice: toNumberOrNull(event.target.value) } : prev))}
                  placeholder="Exit price"
                  className="h-10 rounded-xl border border-white/15 bg-zinc-950/55 px-3 text-sm text-white outline-none"
                />
                <input
                  type="date"
                  value={draft.exitDate?.slice(0, 10) ?? ""}
                  onChange={(event) => {
                    const value = event.target.value ? new Date(`${event.target.value}T00:00:00.000Z`).toISOString() : null;
                    setDraft((prev) => (prev ? { ...prev, exitDate: value } : prev));
                  }}
                  className="h-10 rounded-xl border border-white/15 bg-zinc-950/55 px-3 text-sm text-white outline-none"
                />
              </div>
              <p className="mt-3 text-xs text-white/70">Return: {formatPct(computeLiveReturn(draft))}</p>
              <p className="mt-1 text-xs text-white/70">Days held: {draft.daysHeld ?? "N/A"}</p>
            </section>

            <section
              className={clsx(
                "rounded-2xl border border-white/12 bg-zinc-950/45 p-4",
                !closed && "pointer-events-none opacity-35 border-dashed"
              )}
            >
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/50">Review</p>
              {!closed ? <p className="mt-2 text-xs text-white/70">Unlock when you close this trade.</p> : null}
              <textarea
                value={draft.whatWentRight}
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, whatWentRight: event.target.value } : prev))}
                placeholder="What went right"
                className="mt-3 min-h-[80px] w-full rounded-xl border border-white/15 bg-zinc-950/55 px-3 py-2 text-sm text-white outline-none"
              />
              <textarea
                value={draft.whatWentWrong}
                onChange={(event) => setDraft((prev) => (prev ? { ...prev, whatWentWrong: event.target.value } : prev))}
                placeholder="What went wrong"
                className="mt-3 min-h-[80px] w-full rounded-xl border border-white/15 bg-zinc-950/55 px-3 py-2 text-sm text-white outline-none"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDraft((prev) => (prev ? { ...prev, wouldDoAgain: true } : prev))}
                  className={clsx(
                    "h-9 rounded-lg border px-3 text-sm font-semibold transition",
                    draft.wouldDoAgain === true ? "border-white/45 bg-white/15 text-white" : "border-white/20 bg-white/5 text-white/75"
                  )}
                >
                  Would do again: Yes
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((prev) => (prev ? { ...prev, wouldDoAgain: false } : prev))}
                  className={clsx(
                    "h-9 rounded-lg border px-3 text-sm font-semibold transition",
                    draft.wouldDoAgain === false ? "border-white/45 bg-white/15 text-white" : "border-white/20 bg-white/5 text-white/75"
                  )}
                >
                  No
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  list="journal-tags"
                  placeholder="Add tag"
                  className="h-10 flex-1 rounded-xl border border-white/15 bg-zinc-950/55 px-3 text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const normalized = tagInput.trim().toLowerCase();
                    if (!normalized) return;
                    setDraft((prev) => {
                      if (!prev) return prev;
                      if (prev.tags.includes(normalized)) return prev;
                      return { ...prev, tags: [...prev.tags, normalized] };
                    });
                    setTagInput("");
                  }}
                  className="h-10 rounded-xl border border-white/20 bg-white/5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/80"
                >
                  Add
                </button>
              </div>
              <datalist id="journal-tags">
                {tagSuggestions.map((tag) => (
                  <option key={`tag-opt-${tag}`} value={tag} />
                ))}
              </datalist>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {draft.tags.map((tag) => (
                  <button
                    key={`draft-tag-${tag}`}
                    type="button"
                    onClick={() => setDraft((prev) => (prev ? { ...prev, tags: prev.tags.filter((item) => item !== tag) } : prev))}
                    className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-xs text-white/80"
                  >
                    {tag}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 border-t border-white/12 bg-black/95 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void deleteEntry()}
                disabled={drawerSaving || statusLoading}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/75 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={drawerSaving || statusLoading}
                  className="h-10 rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/85 transition hover:border-white/35 disabled:cursor-not-allowed"
                >
                  {closed ? "Save review" : "Save draft"}
                </button>

                {draft.status === "PLANNING" ? (
                  <button
                    type="button"
                    onClick={() => void transitionStatus("OPEN")}
                    disabled={drawerSaving || statusLoading}
                    className="h-10 rounded-lg border border-[#22C55E]/45 bg-[#22C55E]/10 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#22C55E] disabled:cursor-not-allowed"
                  >
                    Mark open →
                  </button>
                ) : null}

                {draft.status === "OPEN" ? (
                  <button
                    type="button"
                    onClick={() => void transitionStatus("CLOSED")}
                    disabled={drawerSaving || statusLoading}
                    className="h-10 rounded-lg border border-[#EAB308]/45 bg-[#EAB308]/10 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#EAB308] disabled:cursor-not-allowed"
                  >
                    Close trade →
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="min-h-screen overflow-x-hidden text-white" style={{ background: themeMode === "dark" ? "#000000" : "#e9e5dc" }}>
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/15 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        <div className="container mx-auto px-6">
          <div className="flex h-16 items-center justify-between gap-3">
            <button type="button" onClick={() => openDashboardView("home")} className="eldar-logo-button flex cursor-pointer items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden">
                <Image src={ELDAR_BRAND_LOGO} alt="ELDAR logo" fill sizes="40px" className="object-contain" priority />
              </div>
            </button>
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
                  onClick={() => setIsMenuOpen((prev) => !prev)}
                  title="Menu"
                  aria-label="Menu"
                  className={clsx(
                    "flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold transition-all backdrop-blur-xl",
                    isMenuOpen ? "eldar-btn-ghost border-white/60 bg-white/10 text-white" : "eldar-btn-silver text-slate-900"
                  )}
                >
                  <Home className="h-4 w-4" />
                </button>
                {isMenuOpen ? (
                  <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-2xl border border-white/20 bg-zinc-950/90 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-2xl">
                    <button
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
                      onClick={() => {
                        setIsMenuOpen(false);
                        router.push("/macro");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <LineChart className="h-4 w-4" />
                      Macro
                    </button>
                    <button
                      onClick={() => {
                        setIsMenuOpen(false);
                        router.push("/journal");
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                      <BookText className="h-4 w-4" />
                      Journal
                    </button>
                    <button
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
                title="Watchlist"
                aria-label="Watchlist"
                className="eldar-btn-silver relative flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold text-slate-900 transition-all backdrop-blur-xl"
              >
                <Bookmark className="h-4 w-4" />
              </button>

              <SignedOut>
                <SignInButton mode="modal">
                  <button
                    title="Profile"
                    aria-label="Profile"
                    className="eldar-btn-silver flex h-11 w-11 items-center justify-center rounded-2xl border p-0 text-sm font-semibold text-slate-900 transition-all backdrop-blur-xl"
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

      <div className="container mx-auto px-6 pb-12 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">INVESTMENT JOURNAL</h1>
              <p className="mt-1 text-sm text-white/65">Capture one trade decision through 6 steps.</p>
            </div>
            <button
              type="button"
              onClick={() => setNewTradeOpen(true)}
              className="eldar-btn-silver inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" />
              New trade
            </button>
          </div>

          {!isSignedIn ? (
            <div className="rounded-2xl border border-white/15 bg-zinc-950/50 p-6">
              <p className="text-base text-white/85">Sign in to access your private investment journal.</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search trades"
                    className="h-11 w-full rounded-xl border border-white/15 bg-zinc-950/50 pl-10 pr-3 text-sm text-white outline-none"
                  />
                </div>
              </div>

              {renderTabs()}
              {error ? <p className="mb-4 text-sm text-red-300">{error}</p> : null}
              {loading ? (
                <div className="rounded-2xl border border-white/15 bg-zinc-950/45 px-6 py-12 text-sm text-white/70">Loading journal...</div>
              ) : tab === "active" ? (
                renderActiveTrades()
              ) : tab === "closed" ? (
                renderClosedTrades()
              ) : (
                renderReview()
              )}
            </>
          )}
        </div>
      </div>

      {newTradeOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-zinc-950 p-5">
            <h2 className="text-xl font-semibold text-white">New trade</h2>
            <div className="mt-4 space-y-3">
              <div className="relative">
                <input
                  value={newTradeTicker}
                  onChange={(event) => setNewTradeTicker(normalizeTicker(event.target.value))}
                  placeholder="Ticker"
                  className="h-11 w-full rounded-xl border border-white/15 bg-zinc-950/60 px-3 text-sm text-white outline-none"
                />
                {newTradeOpen && (newTradeSearchLoading || newTradeCandidates.length > 0) ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 max-h-52 overflow-y-auto rounded-xl border border-white/15 bg-zinc-950/95 p-1">
                    {newTradeSearchLoading ? (
                      <p className="px-3 py-2 text-xs text-white/65">Searching stocks…</p>
                    ) : (
                      newTradeCandidates.map((candidate) => (
                        <button
                          key={`candidate-${candidate.symbol}`}
                          type="button"
                          onClick={() => {
                            setNewTradeTicker(candidate.symbol);
                            setNewTradeCandidates([]);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-white/10"
                        >
                          <span className="font-mono text-sm text-white">{candidate.symbol}</span>
                          <span className="ml-3 truncate text-xs text-white/65">{candidate.companyName}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              <textarea
                value={newTradeThesis}
                onChange={(event) => setNewTradeThesis(event.target.value)}
                placeholder="Why are you entering? (one sentence)"
                className="min-h-[100px] w-full rounded-xl border border-white/15 bg-zinc-950/60 px-3 py-2 text-sm text-white outline-none"
              />
            </div>
            <p className="mt-3 text-xs text-white/60">ELDAR signal will be captured automatically.</p>
            {newTradeError ? <p className="mt-2 text-xs text-red-300">{newTradeError}</p> : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewTradeOpen(false);
                  setNewTradeError("");
                  setNewTradeCandidates([]);
                }}
                className="h-10 rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/80"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={newTradeLoading || !newTradeTicker || !newTradeThesis.trim()}
                onClick={() => void createTrade({ ticker: newTradeTicker, thesis: newTradeThesis.trim() })}
                className="h-10 rounded-lg border border-white/25 bg-white/10 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {newTradeLoading ? "Creating..." : "Create entry →"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renderDrawer()}
    </main>
  );
}
