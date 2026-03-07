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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">{eyebrow}</p> : null}
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white md:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm leading-6 text-white/65">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
