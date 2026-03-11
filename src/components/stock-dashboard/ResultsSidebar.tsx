import clsx from "clsx";

import { EmptyState, LinesSkeleton } from "@/components/ui/FintechPrimitives";
import type { PersistedAnalysis } from "@/lib/types";

type SectorRelativeState = {
  arrow: string;
  value: string;
  label: string;
  toneClass: string;
};

type RelatedNewsItem = {
  headline: string;
  url: string | null;
};

type JournalRelatedEntry = {
  id: string;
  ticker: string;
  thesis: string;
  status: "PLANNING" | "OPEN" | "CLOSED";
  createdAt: string;
};

type SimilarStock = {
  symbol: string;
  companyName: string;
};

type StockContextLike = {
  sector: string;
  sectorAverageScore: number | null;
  similarStocks: SimilarStock[];
};

type ComparisonEntry = {
  symbol: string;
  loading: boolean;
  score: number;
  sectorScore: number;
  ratingLabel: string;
  heat: "HOT" | "NEUTRAL" | "COLD";
};

type UpgradePath = {
  targetLabel: string | null;
  actions: string[];
};

interface ResultsSidebarProps {
  currentRating: PersistedAnalysis;
  stockContextLoading: boolean;
  stockContext: StockContextLike | null;
  stockContextError: string;
  sectorRelative: SectorRelativeState;
  isNewsExpanded: boolean;
  onToggleNewsExpanded: () => void;
  relatedNewsItems: RelatedNewsItem[];
  currentUserId: string | null;
  journalRelatedLoading: boolean;
  visibleJournalEntries: JournalRelatedEntry[];
  hiddenJournalLinksCount: number;
  showAllJournalLinks: boolean;
  onToggleJournalLinks: () => void;
  onOpenJournalThesis: () => void;
  onOpenJournalEntry: (entryId: string) => void;
  journalRelatedError: string;
  onOpenCommandPalette: () => void;
  onAnalyzeSymbol: (symbol: string) => void;
  onAddComparisonSymbol: (symbol: string) => void;
  comparisonOpen: boolean;
  onCloseComparison: () => void;
  comparisonEntries: ComparisonEntry[];
  sectorHeatLabel: (heat: "HOT" | "NEUTRAL" | "COLD") => string;
  ratingLabelToneClass: (label: string) => string;
  upgradePath: UpgradePath;
}

export function ResultsSidebar({
  currentRating,
  stockContextLoading,
  stockContext,
  stockContextError,
  sectorRelative,
  isNewsExpanded,
  onToggleNewsExpanded,
  relatedNewsItems,
  currentUserId,
  journalRelatedLoading,
  visibleJournalEntries,
  hiddenJournalLinksCount,
  showAllJournalLinks,
  onToggleJournalLinks,
  onOpenJournalThesis,
  onOpenJournalEntry,
  journalRelatedError,
  onOpenCommandPalette,
  onAnalyzeSymbol,
  onAddComparisonSymbol,
  comparisonOpen,
  onCloseComparison,
  comparisonEntries,
  sectorHeatLabel,
  ratingLabelToneClass,
  upgradePath
}: ResultsSidebarProps): JSX.Element {
  return (
    <aside className="space-y-6">
      <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "120ms" }}>
        <h3 className="eldar-caption mb-3 text-xs text-white/60">SECTOR CONTEXT</h3>
        {stockContextLoading ? (
          <LinesSkeleton rows={4} />
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/15 bg-zinc-950/45 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.14em] text-white/55">{stockContext?.sector ?? currentRating.sector}</p>
              <p className="mt-2 text-sm text-white/80">
                ELDAR Sector avg:{" "}
                {typeof stockContext?.sectorAverageScore === "number" ? stockContext.sectorAverageScore.toFixed(1) : currentRating.score.toFixed(1)}
              </p>
              <p className="mt-1 text-sm text-white/80">
                <span>{currentRating.symbol} vs sector</span>
                <span className="mx-2 font-mono">
                  {sectorRelative.arrow} {sectorRelative.value}
                </span>
                <span className={clsx("font-semibold", sectorRelative.toneClass)}>{sectorRelative.label}</span>
              </p>
            </div>
            {stockContextError ? <p className="text-xs text-zinc-200/80">{stockContextError}</p> : null}
          </div>
        )}
      </div>

      <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "180ms" }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="eldar-caption text-xs text-white/60">RELATED NEWS</h3>
          <button
            type="button"
            onClick={onToggleNewsExpanded}
            className="eldar-btn-ghost min-h-[44px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] md:hidden"
          >
            {isNewsExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
        <div
          className={clsx(
            "space-y-2.5",
            !isNewsExpanded && "md:max-h-none md:overflow-visible md:pr-0"
          )}
        >
          {stockContextLoading ? (
            <LinesSkeleton rows={4} />
          ) : (
            relatedNewsItems.map((item, index) => (
              <a
                key={`${item.headline}-${index}`}
                href={item.url ?? `https://finance.yahoo.com/quote/${encodeURIComponent(currentRating.symbol)}/news`}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2 text-xs text-white/80 transition hover:border-white/30 hover:bg-zinc-900/60 hover:text-white"
              >
                <span className="text-white/95">- {item.headline}</span>
              </a>
            ))
          )}
          <a
            href={`https://finance.yahoo.com/quote/${encodeURIComponent(currentRating.symbol)}/news`}
            target="_blank"
            rel="noreferrer"
            className="block w-full rounded-xl border border-white/20 bg-white/[0.04] px-3 py-2 text-left text-xs text-white/80 transition hover:border-white/35 hover:bg-white/[0.08]"
          >
            View all →
          </a>
        </div>
      </div>

      <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "240ms" }}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="eldar-caption text-xs text-white/60">JOURNAL</h3>
          <button
            type="button"
            onClick={onOpenJournalThesis}
            className="eldar-btn-ghost min-h-[36px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
          >
            New entry for {currentRating.symbol}
          </button>
        </div>

        {!currentUserId ? (
          <p className="text-xs text-white/70">Sign in to access private journal entries.</p>
        ) : journalRelatedLoading ? (
          <LinesSkeleton rows={3} />
        ) : visibleJournalEntries.length === 0 ? (
          <EmptyState icon="📓" message={`No journal entries for ${currentRating.symbol}`} action={{ label: "Write first entry", onClick: onOpenJournalThesis }} />
        ) : (
          <div className="space-y-2">
            {visibleJournalEntries.map((entry) => (
              <button
                key={`journal-${entry.id}`}
                type="button"
                onClick={() => onOpenJournalEntry(entry.id)}
                className="w-full rounded-xl border border-white/15 bg-zinc-950/45 px-3 py-2 text-left transition hover:border-white/30"
              >
                <p className="truncate text-xs font-semibold text-white">{entry.ticker}</p>
                <p className="mt-1 text-[10px] text-white/60">
                  {entry.status} • {new Date(entry.createdAt).toLocaleDateString()} • {entry.thesis}
                </p>
              </button>
            ))}
            {hiddenJournalLinksCount > 0 ? (
              <button
                type="button"
                onClick={onToggleJournalLinks}
                className="text-[9px] uppercase tracking-[0.12em] text-[#FFBF00]"
              >
                {showAllJournalLinks ? "Less" : "More"}
              </button>
            ) : null}
          </div>
        )}
        {journalRelatedError ? <p className="mt-2 text-[10px] text-zinc-200/80">{journalRelatedError}</p> : null}
      </div>

      <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "300ms" }}>
        <div className="mb-3 flex items-center">
          <h3 className="eldar-caption text-xs text-white/60">SIMILAR STOCKS</h3>
        </div>

        <div
          className={clsx(
            "gap-2.5",
            "flex overflow-x-auto pb-1 md:block md:space-y-2.5 md:overflow-visible"
          )}
        >
          {stockContextLoading ? (
            <LinesSkeleton rows={3} />
          ) : (stockContext?.similarStocks?.length ?? 0) === 0 ? (
            <EmptyState icon="📊" message="No same-sector stocks available" action={{ label: "Back to search", onClick: onOpenCommandPalette }} />
          ) : (
            (stockContext?.similarStocks ?? []).slice(0, 3).map((item) => (
              <div
                key={item.symbol}
                className="flex min-h-[44px] min-w-[240px] items-center gap-2 rounded-2xl border border-white/20 bg-zinc-950/50 px-3 py-2.5 md:min-w-0"
              >
                <button
                  onClick={() => onAnalyzeSymbol(item.symbol)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate font-mono text-sm font-bold text-white">{item.symbol}</p>
                  <p className="truncate text-[11px] text-white/55">{item.companyName}</p>
                </button>
                <button
                  type="button"
                  onClick={() => onAddComparisonSymbol(item.symbol)}
                  className="eldar-btn-ghost min-h-[36px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
                >
                  Compare
                </button>
              </div>
            ))
          )}
        </div>
        {comparisonOpen ? (
          <div className="mt-4 rounded-2xl border border-white/15 bg-zinc-950/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-white/60">Compare Stocks</p>
                <p className="mt-1 font-mono text-xs text-white/75">{comparisonEntries.map((entry) => entry.symbol).join(" vs ")}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCloseComparison}
                  className="eldar-btn-ghost min-h-[36px] rounded-xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-white/60">ELDAR Rating</p>
                <div className="space-y-2">
                  {comparisonEntries.map((entry, index) => {
                    const winnerScore = Math.max(...comparisonEntries.map((item) => item.score));
                    const isWinner = entry.score >= winnerScore;
                    return (
                      <div key={`cmp-rating-${entry.symbol}`} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-white/80">
                          <span className={clsx("font-mono", isWinner && "text-zinc-100")}>{entry.symbol}</span>
                          <span>{entry.loading ? "Loading..." : entry.score.toFixed(1)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={clsx(
                              "h-full rounded-full transition-all duration-[500ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                              isWinner ? "bg-zinc-100/80" : "bg-zinc-300/45"
                            )}
                            style={{
                              width: `${Math.max(4, Math.min(100, (entry.score / 10) * 100))}%`,
                              transitionDelay: `${index * 100}ms`
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-white/60">Sector Performance</p>
                <div className="space-y-2">
                  {comparisonEntries.map((entry, index) => {
                    const winnerSector = Math.max(...comparisonEntries.map((item) => item.sectorScore));
                    const isWinner = entry.sectorScore >= winnerSector;
                    return (
                      <div key={`cmp-sector-${entry.symbol}`} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-white/80">
                          <span className={clsx("font-mono", isWinner && "text-zinc-100")}>{entry.symbol}</span>
                          <span>
                            {entry.sectorScore.toFixed(1)} ({sectorHeatLabel(entry.heat)})
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={clsx(
                              "h-full rounded-full transition-all duration-[500ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                              isWinner ? "bg-zinc-100/80" : "bg-zinc-300/45"
                            )}
                            style={{
                              width: `${Math.max(4, Math.min(100, (entry.sectorScore / 10) * 100))}%`,
                              transitionDelay: `${index * 100}ms`
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-white/60">Rating</p>
                <div className="space-y-1">
                  {comparisonEntries.map((entry) => (
                    <p key={`cmp-label-${entry.symbol}`} className="text-xs text-white/80">
                      <span>{entry.symbol}: </span>
                      <span className={clsx(!entry.loading && ratingLabelToneClass(entry.ratingLabel))}>
                        {entry.loading ? "Loading..." : entry.ratingLabel}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="eldar-panel reveal-block rounded-3xl p-5" style={{ transitionDelay: "340ms" }}>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-white">WHAT WOULD CHANGE THE RATING</h3>
        {upgradePath.targetLabel ? (
          <p className="mb-3 text-sm text-white/75">To reach {upgradePath.targetLabel}:</p>
        ) : (
          <p className="mb-3 text-sm text-white/75">Current rating is already at the top band.</p>
        )}
        <div className="space-y-1.5 text-sm text-white/82">
          {upgradePath.actions.map((action, index) => (
            <p key={`upgrade-action-bottom-${index}`}>· {action}</p>
          ))}
        </div>
      </div>
    </aside>
  );
}
