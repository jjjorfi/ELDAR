import clsx from "clsx";

import type { Confidence } from "@/lib/presentation";
import { formatAsOfDate, formatAsOfDateOnly, isStale } from "@/lib/presentation";
import { cn } from "@/lib/utils";

interface TrustSignalProps {
  asOfDate: string | null | undefined;
  modelVersion: string;
  prefix?: string;
  className?: string;
}

export function TrustSignal({
  asOfDate,
  modelVersion,
  prefix = "",
  className
}: TrustSignalProps): JSX.Element {
  const stale = isStale(asOfDate);
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <span className="text-[9px] font-mono uppercase tracking-widest text-[#555]">
        {[prefix, formatAsOfDate(asOfDate)].filter(Boolean).join(" ")}
      </span>
      {stale ? (
        <span className="border border-[#EAB308] px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest text-[#EAB308]">
          ⚠ Stale
        </span>
      ) : null}
    </div>
  );
}

export function ChartAsOf({ asOfDate, className }: { asOfDate: string | null | undefined; className?: string }): JSX.Element {
  return (
    <span className={clsx("text-[9px] font-mono uppercase tracking-widest text-[#555]", className)}>
      {formatAsOfDateOnly(asOfDate)}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }): JSX.Element {
  return (
    <span
      className={clsx(
        "border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest",
        confidence === "HIGH" && "border-[#22C55E] text-[#22C55E]",
        confidence === "MEDIUM" && "border-[#EAB308] text-[#EAB308]",
        confidence === "LOW" && "border-[#EF4444] text-[#EF4444]"
      )}
    >
      {confidence} CONFIDENCE
    </span>
  );
}

type EmptyStateVariant = "no-data" | "no-results" | "no-positions" | "no-alerts" | "error";

type EmptyStateAction = {
  label: string;
  onClick: () => void;
};

type LegacyEmptyStateProps = {
  icon: string;
  message: string;
  action?: EmptyStateAction;
  variant?: never;
  title?: never;
  description?: never;
};

type VariantEmptyStateProps = {
  variant: EmptyStateVariant;
  title?: string;
  description?: string;
  action?: EmptyStateAction;
  icon?: never;
  message?: never;
};

const EMPTY_STATE_DEFAULTS: Record<EmptyStateVariant, { icon: string; title: string; description: string }> = {
  "no-data": {
    icon: "◌",
    title: "Nothing here yet",
    description: "Data will appear once markets open and your feed connects."
  },
  "no-results": {
    icon: "⌀",
    title: "No matches",
    description: "Try a different ticker, name, or keyword."
  },
  "no-positions": {
    icon: "▭",
    title: "No open positions",
    description: "Your portfolio is empty. Add a position to start tracking."
  },
  "no-alerts": {
    icon: "◻",
    title: "No active alerts",
    description: "Set a price or event alert and it'll show up here."
  },
  error: {
    icon: "⚠",
    title: "Something went wrong",
    description: "We couldn't load this data. Check your connection or try again."
  }
};

export function EmptyState(props: LegacyEmptyStateProps | VariantEmptyStateProps): JSX.Element {
  if ("variant" in props && props.variant !== undefined) {
    const defaults = EMPTY_STATE_DEFAULTS[props.variant];
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <span className="select-none text-[1.75rem] font-thin leading-none text-white/10">{defaults.icon}</span>
        <p className="text-sm font-medium text-white/40">{props.title ?? defaults.title}</p>
        <p className="max-w-[260px] text-xs leading-6 text-white/20">
          {props.description ?? defaults.description}
        </p>
        {props.action ? (
          <button
            type="button"
            onClick={props.action.onClick}
            className="mt-2 rounded-lg border border-violet-500/30 bg-transparent px-3.5 py-1.5 text-xs text-violet-400/80 transition hover:border-violet-500/60 hover:text-violet-300"
          >
            {props.action.label}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-14">
      <span className="text-4xl opacity-20">{props.icon}</span>
      <p className="max-w-xs text-center font-mono text-[11px] uppercase tracking-widest text-[#555]">{props.message}</p>
      {props.action ? (
        <button
          type="button"
          onClick={props.action.onClick}
          className="border border-[#FFBF00] px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[#FFBF00] hover:bg-[rgba(255,191,0,0.06)]"
        >
          {props.action.label}
        </button>
      ) : null}
    </div>
  );
}

export function RatingCardSkeleton(): JSX.Element {
  return (
    <div className="animate-pulse border border-[#2A2A2A] bg-[#161616] p-5">
      <div className="mb-4 h-2 w-16 bg-[#2A2A2A]" />
      <div className="mb-3 h-8 w-24 bg-[#2A2A2A]" />
      <div className="mb-2 h-2 w-32 bg-[#2A2A2A]" />
      <div className="h-2 w-28 bg-[#2A2A2A]" />
    </div>
  );
}

export function LinesSkeleton({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={`line-skeleton-${index}`} className="h-3 bg-[#2A2A2A]" />
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cn("animate-pulse rounded-md bg-white/6", className)} aria-hidden="true" />;
}

export function StatCardSkeleton(): JSX.Element {
  return (
    <div className="space-y-3 rounded-2xl border border-white/8 bg-zinc-900/60 p-5">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }): JSX.Element {
  return (
    <tr className="border-b border-white/6">
      {Array.from({ length: cols }).map((_, index) => (
        <td key={index} className="px-4 py-3">
          <Skeleton className={cn("h-3.5", index === 0 ? "w-24" : index === cols - 1 ? "w-16" : "w-20")} />
        </td>
      ))}
    </tr>
  );
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }): JSX.Element {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, index) => (
        <TableRowSkeleton key={index} cols={cols} />
      ))}
    </tbody>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }): JSX.Element {
  return (
    <div className="space-y-4 rounded-2xl border border-white/8 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-48 rounded-full" />
      </div>
      <div className="relative overflow-hidden rounded-lg" style={{ height }}>
        <Skeleton className="absolute inset-0" />
        <div className="absolute bottom-0 left-0 right-0 flex items-end gap-1 px-2 pb-2 opacity-30">
          {[40, 65, 45, 80, 55, 70, 50, 90, 60, 75, 55, 85].map((barHeight, index) => (
            <div
              key={index}
              className="flex-1 rounded-t-sm bg-white/20"
              style={{ height: `${barHeight}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PositionRowSkeleton(): JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-white/6 px-4 py-3">
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="space-y-1.5 text-right">
        <Skeleton className="ml-auto h-3.5 w-20" />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
    </div>
  );
}

export function PositionListSkeleton({ rows = 6 }: { rows?: number }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/8 bg-zinc-900/60">
      <div className="border-b border-white/8 px-4 py-4">
        <Skeleton className="h-4 w-28" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <PositionRowSkeleton key={index} />
      ))}
    </div>
  );
}

export function TickerSkeleton(): JSX.Element {
  return (
    <div className="flex items-center gap-6 overflow-hidden">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
