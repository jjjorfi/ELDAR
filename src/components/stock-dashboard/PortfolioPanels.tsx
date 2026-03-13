import { Plus, Search, Share2 } from "lucide-react";
import type { WheelEventHandler } from "react";

import { PortfolioRatingPanel } from "@/components/portfolio";
import { EmptyState, RatingCardSkeleton } from "@/components/ui/FintechPrimitives";
import { Money, Num, Pct } from "@/components/ui/Numeric";
import { RATING_BANDS } from "@/lib/rating";
import type { PortfolioRating } from "@/lib/scoring/portfolio/types";

import { describeDonutSlicePath, scoreBandColor } from "@/components/stock-dashboard/view-helpers";

interface PortfolioWheelRow {
  id: string;
  symbol: string;
  allocationPct: number | null;
  score: number | null;
  startAngle: number;
  endAngle: number;
}

interface ActivePortfolioWheelRow {
  symbol: string;
  allocationPct: number | null;
}

interface PortfolioDrawerRow {
  id: string;
  symbol: string;
  allocationPct: number | null;
  shares: number;
  positionValue: number | null;
  currency: string;
  score: number | null;
  ratingLabel: string | null;
  error: string | null;
}

interface PortfolioMainPanelProps {
  activePortfolioRating: PortfolioRating | null;
  portfolioInputTicker: string;
  portfolioInputShares: string;
  portfolioError: string;
  portfolioHoldingsCount: number;
  portfolioWheelRows: PortfolioWheelRow[];
  portfolioWheelHoverId: string | null;
  portfolioDrawerHoldingId: string | null;
  activePortfolioWheelRow: ActivePortfolioWheelRow | null;
  onOpenShare: () => void;
  onOpenPaletteForAdd: (value: string) => void;
  onSubmitAdd: () => void;
  onSharesChange: (value: string) => void;
  onWheelHover: (id: string) => void;
  onWheelLeave: (id: string) => void;
  onWheelSelect: (id: string) => void;
}

export function PortfolioMainPanel({
  activePortfolioRating,
  portfolioInputTicker,
  portfolioInputShares,
  portfolioError,
  portfolioHoldingsCount,
  portfolioWheelRows,
  portfolioWheelHoverId,
  portfolioDrawerHoldingId,
  activePortfolioWheelRow,
  onOpenShare,
  onOpenPaletteForAdd,
  onSubmitAdd,
  onSharesChange,
  onWheelHover,
  onWheelLeave,
  onWheelSelect
}: PortfolioMainPanelProps): JSX.Element {
  return (
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">Portfolio Health Checker</h1>
          <p className="mt-2 text-sm text-white/70">Build and evaluate your holdings with a weighted ELDAR portfolio score.</p>
        </div>
        <button
          type="button"
          onClick={onOpenShare}
          disabled={!activePortfolioRating}
          className="eldar-share-inline inline-flex min-h-[40px] items-center gap-2 px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60"
        >
          <Share2 className="h-4 w-4" />
          Share
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(250px,0.55fr)_minmax(0,1.45fr)]">
        <div className="space-y-3">
          <div className="eldar-panel reveal-block rounded-3xl p-4">
            <p className="mb-2 text-sm text-white/75">Add Your Stocks:</p>
            <form
              className="card-grain grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_86px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmitAdd();
              }}
            >
              <div className="btn-outer min-h-[44px] w-full rounded-[2rem]">
                <button
                  type="button"
                  onClick={() => onOpenPaletteForAdd(portfolioInputTicker || "")}
                  className="btn eldar-search-shell min-h-[44px] rounded-[2rem] text-left text-sm font-semibold"
                >
                  <div className="btn-inner" />
                  <span className="eldar-search-shell__inner gap-2 pl-4 pr-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <Search className="eldar-search-shell__icon h-4 w-4" />
                      <span className="eldar-search-shell__copy truncate">{portfolioInputTicker ? portfolioInputTicker : "Search"}</span>
                    </span>
                    <span className="eldar-search-shell__hint rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                      /
                    </span>
                  </span>
                </button>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={portfolioInputShares}
                onChange={(event) => onSharesChange(event.target.value)}
                placeholder="Quantity"
                className="min-h-[44px] w-full rounded-xl border border-white/20 bg-white/5 px-2 py-2 text-center text-sm text-white outline-none placeholder:text-white/45"
              />
              <button
                type="submit"
                className="eldar-btn-silver primary-cta flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </form>
            {portfolioError ? <p className="mt-2 text-xs text-zinc-200/85">{portfolioError}</p> : null}
          </div>

          <div className="eldar-panel reveal-block rounded-3xl p-4">
            {portfolioHoldingsCount === 0 ? (
              <EmptyState
                icon="📊"
                message="No holdings yet"
                action={{ label: "Add holdings", onClick: () => onOpenPaletteForAdd("") }}
              />
            ) : (
              <div className="p-1">
                <div className="flex items-center justify-center">
                  <svg viewBox="0 0 260 260" className="h-[210px] w-[210px]" role="img" aria-label="Portfolio holdings wheel">
                    <circle cx="130" cy="130" r="108" fill="#0c0c0c" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                    {portfolioWheelRows.map((row) => (
                      <path
                        key={`wheel-${row.id}`}
                        d={describeDonutSlicePath(130, 130, 52, 108, row.startAngle, row.endAngle)}
                        fill={scoreBandColor(row.score)}
                        fillOpacity={portfolioWheelHoverId === row.id || portfolioDrawerHoldingId === row.id ? 0.8 : 0.38}
                        stroke="rgba(255,255,255,0.16)"
                        strokeWidth={portfolioWheelHoverId === row.id || portfolioDrawerHoldingId === row.id ? 1.8 : 1}
                        className="cursor-pointer transition-all duration-150"
                        onMouseEnter={() => onWheelHover(row.id)}
                        onMouseLeave={() => onWheelLeave(row.id)}
                        onClick={() => onWheelSelect(row.id)}
                      />
                    ))}
                    <circle cx="130" cy="130" r="52" fill="#0a0a0a" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
                    <text
                      x="130"
                      y="121"
                      textAnchor="middle"
                      fontSize="15"
                      fontWeight="700"
                      fontFamily="Neue Haas Grotesk Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                      fill="#f5f5f5"
                    >
                      {activePortfolioWheelRow?.symbol ?? "—"}
                    </text>
                    <text
                      x="130"
                      y="141"
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="Neue Haas Grotesk Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                      fill="#9ca3af"
                    >
                      {activePortfolioWheelRow?.allocationPct !== null && activePortfolioWheelRow?.allocationPct !== undefined
                        ? `${activePortfolioWheelRow.allocationPct >= 0 ? "" : "-"}${Math.abs(activePortfolioWheelRow.allocationPct).toFixed(1)}%`
                        : "allocation"}
                    </text>
                  </svg>
                </div>
                {activePortfolioRating ? (
                  <div className="mt-2 text-center">
                    <p className="text-xl font-bold text-white">
                      {"★".repeat(activePortfolioRating.stars)}
                      {"☆".repeat(5 - activePortfolioRating.stars)}
                    </p>
                    <p
                      className="mt-1 text-sm font-semibold"
                      style={{ color: RATING_BANDS[activePortfolioRating.rating].color }}
                    >
                      {RATING_BANDS[activePortfolioRating.rating].label}
                    </p>
                    <p className="mt-1 text-xs text-white/60">Rated vs: {activePortfolioRating.peerGroup} peers</p>
                  </div>
                ) : (
                  <p className="mt-1 text-center text-sm font-semibold text-white/75">Portfolio Rating</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="eldar-panel reveal-block rounded-3xl p-4">
          {activePortfolioRating ? <PortfolioRatingPanel rating={activePortfolioRating} /> : <RatingCardSkeleton />}
        </div>
      </div>
    </div>
  );
}

interface PortfolioHoldingDrawerProps {
  drawerRow: PortfolioDrawerRow;
  onClose: () => void;
  onRefresh: (symbol: string) => void;
  onRemove: (id: string) => void;
  onWheelCapture: WheelEventHandler<HTMLDivElement>;
}

export function PortfolioHoldingDrawer({
  drawerRow,
  onClose,
  onRefresh,
  onRemove,
  onWheelCapture
}: PortfolioHoldingDrawerProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-[95]">
      <button type="button" aria-label="Close drawer" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <aside className="card-grain rough-border absolute right-0 top-0 h-full w-full max-w-[480px] border-l border-white/15 bg-[#0a0a0a] p-5 shadow-2xl shadow-black/70">
        <div className="sticky top-0 z-10 mb-4 flex items-center justify-between border-b border-white/10 bg-[#0a0a0a] pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Holding Details</p>
            <p className="mt-1 font-mono text-xl font-bold text-white">{drawerRow.symbol}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="eldar-btn-ghost min-h-[40px] rounded-xl px-3 text-xs font-semibold uppercase tracking-[0.12em]"
          >
            Close
          </button>
        </div>
        <div onWheelCapture={onWheelCapture} className="eldar-scrollbar space-y-3 overflow-y-auto pb-24">
          <div className="rounded-xl border border-white/12 bg-black/25 p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Allocation</p>
            {drawerRow.allocationPct !== null ? (
              <Pct value={drawerRow.allocationPct} decimals={1} signed={false} color={false} className="mt-1 text-2xl font-bold text-white" />
            ) : (
              <p className="mt-1 font-mono text-2xl font-bold text-white">Pending</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/12 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Shares</p>
              <Num
                value={drawerRow.shares}
                decimals={Number.isInteger(drawerRow.shares) ? 0 : 4}
                className="mt-1 text-lg font-semibold text-white"
              />
            </div>
            <div className="rounded-xl border border-white/12 bg-black/25 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">Position Value</p>
              {drawerRow.positionValue !== null ? (
                <Money
                  value={drawerRow.positionValue}
                  currency={drawerRow.currency}
                  className="mt-1 text-lg font-semibold text-white"
                />
              ) : (
                <p className="mt-1 font-mono text-lg font-semibold text-white">N/A</p>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-white/12 bg-black/25 p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/55">ELDAR Band</p>
            <p className="mt-1 text-sm font-semibold" style={{ color: scoreBandColor(drawerRow.score) }}>
              {drawerRow.ratingLabel ?? "Pending"}
            </p>
          </div>
          {drawerRow.error ? (
            <div className="rounded-xl border border-red-300/30 bg-red-400/10 p-3 text-xs text-red-100">{drawerRow.error}</div>
          ) : null}
        </div>
        <div className="sticky bottom-0 z-10 mt-4 flex items-center gap-2 border-t border-white/10 bg-[#0a0a0a] pt-3">
          <button
            type="button"
            onClick={() => {
              onRefresh(drawerRow.symbol);
            }}
            className="eldar-btn-silver min-h-[44px] flex-1 rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => onRemove(drawerRow.id)}
            className="eldar-btn-ghost min-h-[44px] flex-1 rounded-xl px-4 text-xs font-semibold uppercase tracking-[0.12em]"
          >
            Remove
          </button>
        </div>
      </aside>
    </div>
  );
}
