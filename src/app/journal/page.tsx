"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, FileText, Search, Trash2 } from "lucide-react";

import { getJournalTemplate } from "@/lib/journal/templates";
import { getTop100Sp500Symbols } from "@/lib/market/top100";
import type {
  JournalEntry,
  JournalEntrySymbol,
  JournalEntryType,
  JournalListResult,
  JournalSentiment,
  JournalStatus,
  JournalTimeHorizon
} from "@/lib/journal/types";

const ENTRY_TYPES: JournalEntryType[] = [
  "freeform",
  "thesis",
  "earnings_review",
  "postmortem",
  "watchlist_note"
];
const SYMBOL_OPTIONS = getTop100Sp500Symbols();

interface EditorState {
  title: string;
  contentMd: string;
  entryType: JournalEntryType;
  sentiment: JournalSentiment | null;
  conviction: number | null;
  timeHorizon: JournalTimeHorizon | null;
  status: JournalStatus;
  symbolsInput: string;
  primarySymbol: string;
  tagsInput: string;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function parseSymbols(symbolsInput: string, primarySymbol: string): JournalEntrySymbol[] {
  const raw = symbolsInput
    .split(",")
    .map((item) => normalizeSymbol(item))
    .filter(Boolean);
  const deduped = Array.from(new Set(raw)).slice(0, 10);
  const primary = normalizeSymbol(primarySymbol);
  return deduped.map((symbol, index) => ({
    symbol,
    primary: primary ? symbol === primary : index === 0
  }));
}

function parseTags(tagsInput: string): string[] {
  return Array.from(
    new Set(
      tagsInput
        .split(",")
        .map((item) => item.trim().toLowerCase().replace(/[^a-z0-9_\- ]/g, "").replace(/\s+/g, "-"))
        .filter(Boolean)
    )
  ).slice(0, 20);
}

function toEditorState(entry: JournalEntry): EditorState {
  const primary = entry.symbols.find((item) => item.primary)?.symbol ?? entry.symbols[0]?.symbol ?? "";
  return {
    title: entry.title,
    contentMd: entry.contentMd,
    entryType: entry.entryType,
    sentiment: entry.sentiment,
    conviction: entry.conviction,
    timeHorizon: entry.timeHorizon,
    status: entry.status,
    symbolsInput: entry.symbols.map((item) => item.symbol).join(", "),
    primarySymbol: primary,
    tagsInput: entry.tags.join(", ")
  };
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

export default function JournalPage(): JSX.Element {
  const router = useRouter();
  const autosaveTimerRef = useRef<number | null>(null);
  const hydratedEditorRef = useRef(false);

  const [q, setQ] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<JournalEntryType | "">("");
  const [statusFilter, setStatusFilter] = useState<JournalStatus | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [insights, setInsights] = useState<JournalListResult["insights"]>({
    symbol: null,
    lastThesis: null,
    lastEarningsReview: null,
    openDrafts: []
  });
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isEditing, setIsEditing] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [symbolPrefill, setSymbolPrefill] = useState<string | null>(null);
  const [typePrefill, setTypePrefill] = useState<string | null>(null);

  const activeType = useMemo<JournalEntryType | null>(() => {
    if (!typePrefill) return null;
    if (ENTRY_TYPES.includes(typePrefill as JournalEntryType)) return typePrefill as JournalEntryType;
    return null;
  }, [typePrefill]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSymbolPrefill(params.get("symbol"));
    setTypePrefill(params.get("type"));
  }, []);

  const loadEntries = useCallback(
    async (options?: { cursor?: string | null; append?: boolean }) => {
      setListLoading(true);
      setListError("");
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (symbolFilter.trim()) params.set("symbol", symbolFilter.trim().toUpperCase());
        if (tagFilter.trim()) params.set("tag", tagFilter.trim());
        if (typeFilter) params.set("type", typeFilter);
        if (statusFilter) params.set("status", statusFilter);
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        params.set("limit", "20");
        if (options?.cursor) params.set("cursor", options.cursor);

        const response = await fetch(`/api/journal/entries?${params.toString()}`, {
          method: "GET",
          cache: "no-store"
        });
        const payload = (await response.json()) as JournalListResult & { error?: string };
        if (!response.ok || !Array.isArray(payload.items)) {
          throw new Error(payload.error ?? "Failed to load entries.");
        }

        setEntries((prev) => (options?.append ? [...prev, ...payload.items] : payload.items));
        setNextCursor(payload.nextCursor ?? null);
        setInsights(payload.insights);

        if (!options?.append && payload.items.length > 0 && !selectedId) {
          setSelectedId(payload.items[0].id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load entries.";
        setListError(message);
      } finally {
        setListLoading(false);
      }
    },
    [fromDate, q, selectedId, statusFilter, symbolFilter, tagFilter, toDate, typeFilter]
  );

  const loadEntry = useCallback(async (entryId: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/journal/entries/${encodeURIComponent(entryId)}`, {
        method: "GET",
        cache: "no-store"
      });
      const payload = (await response.json()) as { entry?: JournalEntry; error?: string };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error ?? "Failed to load entry.");
      }
      setSelectedEntry(payload.entry);
      setEditor(toEditorState(payload.entry));
      hydratedEditorRef.current = true;
      setSaveMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load entry.";
      setSaveMessage(message);
      setSelectedEntry(null);
      setEditor(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const createEntry = useCallback(
    async (entryType: JournalEntryType, forcedSymbol?: string | null) => {
      setSaving(true);
      try {
        const symbol = forcedSymbol ? normalizeSymbol(forcedSymbol) : "";
        const response = await fetch("/api/journal/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `New ${entryType.replace(/_/g, " ")}`,
            contentMd: getJournalTemplate(entryType),
            entryType,
            status: "draft",
            symbols: symbol ? [{ symbol, primary: true }] : [],
            useTemplate: true
          })
        });
        const payload = (await response.json()) as { entry?: JournalEntry; error?: string };
        if (!response.ok || !payload.entry) {
          throw new Error(payload.error ?? "Failed to create entry.");
        }
        const created = payload.entry;
        setEntries((prev) => [created, ...prev]);
        setSelectedId(created.id);
        setSelectedEntry(created);
        setEditor(toEditorState(created));
        hydratedEditorRef.current = true;
        setIsEditing(true);
        setSaveMessage("Draft created.");
      } catch (error) {
        setSaveMessage(error instanceof Error ? error.message : "Failed to create entry.");
      } finally {
        setSaving(false);
      }
    },
    []
  );

  useEffect(() => {
    if (symbolPrefill && !symbolFilter) {
      setSymbolFilter(normalizeSymbol(symbolPrefill));
    }
    if (activeType && !typeFilter) {
      setTypeFilter(activeType);
    }
  }, [activeType, symbolFilter, symbolPrefill, typeFilter]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!selectedId) return;
    void loadEntry(selectedId);
  }, [loadEntry, selectedId]);

  useEffect(() => {
    if (!selectedEntry || !editor) return;
    if (!hydratedEditorRef.current) return;
    if (selectedEntry.status !== "draft") return;

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          setSaving(true);
          const response = await fetch(`/api/journal/entries/${encodeURIComponent(selectedEntry.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: editor.title,
              contentMd: editor.contentMd,
              entryType: editor.entryType,
              sentiment: editor.sentiment,
              conviction: editor.conviction,
              timeHorizon: editor.timeHorizon,
              status: editor.status,
              symbols: parseSymbols(editor.symbolsInput, editor.primarySymbol),
              tags: parseTags(editor.tagsInput)
            })
          });
          const payload = (await response.json()) as { entry?: JournalEntry; error?: string };
          if (!response.ok || !payload.entry) {
            throw new Error(payload.error ?? "Autosave failed.");
          }
          setSelectedEntry(payload.entry);
          setEntries((prev) => prev.map((item) => (item.id === payload.entry?.id ? payload.entry : item)));
          setSaveMessage("Saved");
        } catch (error) {
          setSaveMessage(error instanceof Error ? error.message : "Autosave failed.");
        } finally {
          setSaving(false);
        }
      })();
    }, 700);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [editor, selectedEntry]);

  async function toggleFinalize(reopen: boolean): Promise<void> {
    if (!selectedEntry) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/journal/entries/${encodeURIComponent(selectedEntry.id)}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reopen })
      });
      const payload = (await response.json()) as { entry?: JournalEntry; error?: string };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error ?? "Failed to update status.");
      }
      setSelectedEntry(payload.entry);
      setEntries((prev) => prev.map((item) => (item.id === payload.entry?.id ? payload.entry : item)));
      setEditor(toEditorState(payload.entry));
      setSaveMessage(reopen ? "Entry re-opened." : "Entry finalized.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Status update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!selectedEntry) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/journal/entries/${encodeURIComponent(selectedEntry.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to delete entry.");
      }
      setEntries((prev) => prev.filter((item) => item.id !== selectedEntry.id));
      setSelectedEntry(null);
      setEditor(null);
      setSelectedId(null);
      setSaveMessage("Entry deleted.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateSelected(): Promise<void> {
    if (!selectedEntry) return;
    await createEntry(selectedEntry.entryType, selectedEntry.symbols.find((item) => item.primary)?.symbol ?? null);
    setEditor((prev) =>
      prev
        ? {
            ...prev,
            title: `${selectedEntry.title} (Copy)`,
            contentMd: selectedEntry.contentMd,
            sentiment: selectedEntry.sentiment,
            conviction: selectedEntry.conviction,
            timeHorizon: selectedEntry.timeHorizon,
            symbolsInput: selectedEntry.symbols.map((item) => item.symbol).join(", "),
            primarySymbol: selectedEntry.symbols.find((item) => item.primary)?.symbol ?? "",
            tagsInput: selectedEntry.tags.join(", "),
            status: "draft"
          }
        : prev
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-6 pb-20 pt-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="eldar-btn-silver inline-flex h-10 w-10 items-center justify-center rounded-xl border"
              title="Back to Dashboard"
              aria-label="Back to Dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="text-2xl font-bold tracking-tight">JOURNAL</h1>
          </div>
          <button
            type="button"
            onClick={() => void createEntry(activeType ?? "freeform", symbolPrefill)}
            className="eldar-btn-silver rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            New Entry
          </button>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-7">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search notes"
              className="h-10 w-full rounded-xl border border-white/15 bg-zinc-950/50 pl-10 pr-3 text-sm text-white outline-none"
            />
          </div>
          <input
            value={symbolFilter}
            onChange={(event) => setSymbolFilter(normalizeSymbol(event.target.value))}
            placeholder="Symbol"
            list="journal-symbol-options"
            className="h-10 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
          />
          <input
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            placeholder="Tag"
            className="h-10 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
          />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as JournalEntryType | "")}
            className="h-10 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
          >
            <option value="">All types</option>
            {ENTRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as JournalStatus | "")}
            className="h-10 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
          >
            <option value="">All status</option>
            <option value="draft">Draft</option>
            <option value="final">Final</option>
          </select>
          <button
            type="button"
            onClick={() => void loadEntries()}
            className="eldar-btn-silver h-10 rounded-xl border px-3 text-sm font-semibold"
          >
            Apply
          </button>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-5">
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className="h-10 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
          />
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className="h-10 rounded-xl border border-white/15 bg-zinc-950/50 px-3 text-sm text-white outline-none"
          />
          <div className="md:col-span-3 flex items-center gap-3 text-xs text-white/70">
            {insights.symbol ? (
              <>
                <span>Last thesis: {insights.lastThesis ? insights.lastThesis.title : "None"}</span>
                <span>|</span>
                <span>
                  Last earnings review: {insights.lastEarningsReview ? insights.lastEarningsReview.title : "None"}
                </span>
                <span>|</span>
                <span>Open drafts: {insights.openDrafts.length}</span>
              </>
            ) : (
              <span>Filter by symbol to see recall helpers.</span>
            )}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_1.9fr]">
          <aside className="space-y-3">
            {listError ? <p className="text-sm text-red-300">{listError}</p> : null}
            {listLoading && entries.length === 0 ? <p className="text-sm text-white/70">Loading entries...</p> : null}
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className={clsx(
                  "w-full rounded-xl border bg-zinc-950/50 p-3 text-left transition",
                  selectedId === entry.id ? "border-white/35" : "border-white/15 hover:border-white/25"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-white">{entry.title}</p>
                  <span className="text-[10px] uppercase tracking-[0.1em] text-white/55">{entry.status}</span>
                </div>
                <p className="mt-1 text-[11px] text-white/65">{new Date(entry.createdAt).toLocaleString()}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.symbols.slice(0, 3).map((item) => (
                    <span key={`${entry.id}-${item.symbol}`} className="rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] text-white/75">
                      {item.symbol}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-white/75">{excerpt(entry.contentPlain || entry.contentMd)}</p>
              </button>
            ))}
            {nextCursor ? (
              <button
                type="button"
                onClick={() => void loadEntries({ cursor: nextCursor, append: true })}
                className="eldar-btn-silver w-full rounded-xl border px-3 py-2 text-sm font-semibold"
              >
                Load more
              </button>
            ) : null}
          </aside>

          <section className="rounded-2xl border border-white/15 bg-zinc-950/50 p-4">
            {detailLoading ? (
              <p className="text-sm text-white/70">Loading entry...</p>
            ) : !selectedEntry || !editor ? (
              <div className="text-sm text-white/70">
                <p>Select an entry to view/edit, or create a new one.</p>
                {symbolPrefill ? (
                  <button
                    type="button"
                    onClick={() => void createEntry(activeType ?? "thesis", symbolPrefill)}
                    className="mt-3 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
                  >
                    New entry for {normalizeSymbol(symbolPrefill)}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing((prev) => !prev)}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold"
                    >
                      {isEditing ? "Read mode" : "Edit mode"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void duplicateSelected()}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold"
                    >
                      <Copy className="mr-1 inline h-3.5 w-3.5" />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSelected()}
                      className="rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-200"
                    >
                      <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                      Delete
                    </button>
                    {selectedEntry.status === "draft" ? (
                      <button
                        type="button"
                        onClick={() => void toggleFinalize(false)}
                        className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-200"
                      >
                        Finalize
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void toggleFinalize(true)}
                        className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold"
                      >
                        Re-open
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <>
                      <input
                        value={editor.title}
                        onChange={(event) => setEditor((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                        className="mb-3 h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3 text-base text-white outline-none"
                        placeholder="Entry title"
                      />
                      <textarea
                        value={editor.contentMd}
                        onChange={(event) => setEditor((prev) => (prev ? { ...prev, contentMd: event.target.value } : prev))}
                        className="h-[430px] w-full rounded-xl border border-white/20 bg-black/30 p-3 text-sm text-white outline-none"
                        placeholder="Write in Markdown..."
                      />
                    </>
                  ) : (
                    <article className="rounded-xl border border-white/15 bg-black/30 p-4">
                      <h2 className="text-xl font-semibold text-white">{selectedEntry.title}</h2>
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/85">{selectedEntry.contentMd}</div>
                    </article>
                  )}

                  <div className="mt-3 text-xs text-white/65">
                    {saving ? "Saving..." : saveMessage || "Autosave for drafts is enabled."}
                  </div>
                </div>

                <aside className="space-y-3">
                  <div className="rounded-xl border border-white/15 bg-black/30 p-3">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/60">Metadata</p>
                    <div className="mt-2 space-y-2">
                      <label className="block text-xs text-white/70">
                        Type
                        <select
                          value={editor.entryType}
                          onChange={(event) =>
                            setEditor((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    entryType: event.target.value as JournalEntryType,
                                    contentMd: prev.contentMd || getJournalTemplate(event.target.value as JournalEntryType)
                                  }
                                : prev
                            )
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-zinc-900 px-2 text-xs text-white outline-none"
                        >
                          {ENTRY_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs text-white/70">
                        Symbols (comma separated)
                        <input
                          value={editor.symbolsInput}
                          onChange={(event) => setEditor((prev) => (prev ? { ...prev, symbolsInput: event.target.value } : prev))}
                          list="journal-symbol-options"
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-zinc-900 px-2 text-xs text-white outline-none"
                          placeholder="AAPL, MSFT"
                        />
                      </label>

                      <label className="block text-xs text-white/70">
                        Primary symbol
                        <input
                          value={editor.primarySymbol}
                          onChange={(event) => setEditor((prev) => (prev ? { ...prev, primarySymbol: normalizeSymbol(event.target.value) } : prev))}
                          list="journal-symbol-options"
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-zinc-900 px-2 text-xs text-white outline-none"
                          placeholder="AAPL"
                        />
                      </label>

                      <label className="block text-xs text-white/70">
                        Tags (comma separated)
                        <input
                          value={editor.tagsInput}
                          onChange={(event) => setEditor((prev) => (prev ? { ...prev, tagsInput: event.target.value } : prev))}
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-zinc-900 px-2 text-xs text-white outline-none"
                          placeholder="valuation, catalyst"
                        />
                      </label>

                      <label className="block text-xs text-white/70">
                        Sentiment
                        <select
                          value={editor.sentiment ?? ""}
                          onChange={(event) =>
                            setEditor((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    sentiment: event.target.value ? (event.target.value as JournalSentiment) : null
                                  }
                                : prev
                            )
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-zinc-900 px-2 text-xs text-white outline-none"
                        >
                          <option value="">None</option>
                          <option value="bull">Bull</option>
                          <option value="bear">Bear</option>
                          <option value="neutral">Neutral</option>
                        </select>
                      </label>

                      <label className="block text-xs text-white/70">
                        Conviction
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={editor.conviction ?? ""}
                          onChange={(event) =>
                            setEditor((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    conviction: event.target.value ? Number.parseInt(event.target.value, 10) : null
                                  }
                                : prev
                            )
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-zinc-900 px-2 text-xs text-white outline-none"
                        />
                      </label>

                      <label className="block text-xs text-white/70">
                        Horizon
                        <select
                          value={editor.timeHorizon ?? ""}
                          onChange={(event) =>
                            setEditor((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    timeHorizon: event.target.value ? (event.target.value as JournalTimeHorizon) : null
                                  }
                                : prev
                            )
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-zinc-900 px-2 text-xs text-white outline-none"
                        >
                          <option value="">None</option>
                          <option value="weeks">Weeks</option>
                          <option value="months">Months</option>
                          <option value="years">Years</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/15 bg-black/30 p-3 text-xs text-white/75">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-white/60">Related</p>
                    {selectedEntry.symbols.length === 0 ? (
                      <p>No linked symbols.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedEntry.symbols.map((item) => (
                          <Link
                            key={`related-${item.symbol}`}
                            href={`/?symbol=${encodeURIComponent(item.symbol)}`}
                            className="rounded-md border border-white/20 px-2 py-1 text-[11px] hover:border-white/40"
                          >
                            <FileText className="mr-1 inline h-3 w-3" />
                            {item.symbol}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            )}
          </section>
        </div>
        <datalist id="journal-symbol-options">
          {SYMBOL_OPTIONS.map((symbol) => (
            <option key={`journal-opt-${symbol}`} value={symbol} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
