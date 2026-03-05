import clsx from "clsx";

import type { Confidence } from "@/lib/presentation";
import { formatAsOfDate, formatAsOfDateOnly, isStale } from "@/lib/presentation";

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

export function EmptyState({
  icon,
  message,
  action
}: {
  icon: string;
  message: string;
  action: { label: string; onClick: () => void };
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-14">
      <span className="text-4xl opacity-20">{icon}</span>
      <p className="max-w-xs text-center font-mono text-[11px] uppercase tracking-widest text-[#555]">{message}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="border border-[#FFBF00] px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[#FFBF00] hover:bg-[rgba(255,191,0,0.06)]"
      >
        {action.label}
      </button>
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
