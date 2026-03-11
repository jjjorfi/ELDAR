// AI CONTEXT TRACE
// Shared page header for standalone pages. This standardizes title hierarchy,
// subtitle spacing, and action placement so sectors, macro, and journal read as
// one product instead of three separate implementations.

"use client";

import type { ReactNode } from "react";

export function AppPageHeader({
  eyebrow,
  title,
  subtitle,
  actions
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">{eyebrow}</p> : null}
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-[2.6rem]">{title}</h1>
        {subtitle ? <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}
