import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

interface BaseProps {
  className?: string;
  children: ReactNode;
}

export function CardPlain({ className, children }: BaseProps): JSX.Element {
  return (
    <section className={clsx("rough-border texture-card border border-white/10 bg-[#0f0f0f] p-6 md:p-8", className)}>
      {children}
    </section>
  );
}

export function CardFramed({ className, children }: BaseProps): JSX.Element {
  return (
    <section className={clsx("rough-border texture-card accent-border-left border border-white/10 bg-[#0f0f0f] p-6 md:p-8", className)}>
      {children}
    </section>
  );
}

export function CardNote({ className, children }: BaseProps): JSX.Element {
  return (
    <article className={clsx("rough-border texture-card border border-white/10 bg-[#101010] p-6", className)}>{children}</article>
  );
}

export function EditorialDivider({ className, dashed = false }: { className?: string; dashed?: boolean }): JSX.Element {
  return <hr className={clsx("border-0 border-t border-white/10", dashed && "border-dashed", className)} />;
}

export function Chip({ className, children }: BaseProps): JSX.Element {
  return (
    <span className={clsx("inline-flex items-center border border-white/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/70", className)}>
      {children}
    </span>
  );
}

export function TerminalButton({
  variant = "ghost",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }): JSX.Element {
  return (
    <button
      {...props}
      className={clsx(
        "min-h-[44px] border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all duration-200 ease-out",
        variant === "primary"
          ? "primary-cta border-[#FFBF00]/60 bg-[#FFBF00]/10 text-[#FFBF00]"
          : "border-white/20 bg-white/[0.03] text-white/80 hover:border-white/35 hover:bg-white/[0.08]",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TinyTooltip({ label, className }: { label: string; className?: string }): JSX.Element {
  return (
    <span
      className={clsx("cursor-help text-[9px] uppercase tracking-[0.12em] text-white/45", className)}
      aria-label={label}
    >
      ⓘ
    </span>
  );
}

export function SkeletonBlock({ className }: { className?: string }): JSX.Element {
  return <div className={clsx("h-4 animate-pulse bg-white/10", className)} aria-hidden="true" />;
}

export function TableSurface({ className, children }: BaseProps): JSX.Element {
  return (
    <div className={clsx("texture-table rough-border overflow-hidden border border-white/10 bg-[#0f0f0f]", className)}>{children}</div>
  );
}

export function ExpandableRowShell({ className, children, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      {...props}
      className={clsx("cursor-pointer border-b border-white/10 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.03]", className)}
    >
      {children}
    </div>
  );
}
