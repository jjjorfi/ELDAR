"use client";

// AI CONTEXT TRACE
// This component owns the pre-app landing experience for StockDashboard's !isAppOpen branch.
// It is intentionally more cinematic and selective than the in-app dashboard: the goal is to signal
// taste, trust, and momentum without dumping the full product model before the user enters the app.
// It consumes the existing Mag7 score payload from app/page.tsx so the page feels live without adding
// another fetch path or slowing down the manual "Enter Terminal" transition.

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useMemo } from "react";
import {
  ArrowUpRight,
  BookMarked,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Waypoints
} from "lucide-react";

import type { Mag7ScoreCard } from "@/lib/types";

interface HeroLandingProps {
  logoSrc: string;
  scores: Mag7ScoreCard[];
  onOpenApp: () => void;
}

const NAV_ITEMS = [
  { label: "Quiet", href: "#signal" },
  { label: "Surface", href: "#surface" },
  { label: "Entry", href: "#memory" }
] as const;

const TRUST_MARKERS = [
  { label: "Private workspace", icon: LockKeyhole },
  { label: "Live market data", icon: ShieldCheck },
  { label: "11 sectors watched", icon: ShieldCheck }
] as const;

const PILLARS = [
  {
    id: "signal",
    title: "Stay early without getting loud.",
    body: "The useful read arrives before the explanation does."
  },
  {
    id: "surface",
    title: "The room does not need to know why.",
    body: "A good surface lets you keep the edge private while you decide."
  },
  {
    id: "memory",
    title: "Calm beats spectacle.",
    body: "Less theater. Less noise. Better timing."
  }
] as const;

function InsightCard({
  title,
  body,
  icon: Icon
}: {
  title: string;
  body: string;
  icon: typeof Sparkles;
}): JSX.Element {
  return (
    <article className="eldar-dashboard-surface rounded-[26px] p-6 md:p-7">
      <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] text-white/72">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="text-[1.45rem] font-semibold tracking-[-0.03em] text-white">{title}</h2>
      <p className="mt-3 max-w-[28rem] text-sm leading-7 text-white/62">{body}</p>
    </article>
  );
}

export function HeroLanding({ logoSrc, scores, onOpenApp }: HeroLandingProps): JSX.Element {
  const rankedSignals = useMemo(
    () =>
      scores
        .slice()
        .sort((left, right) => Math.abs(right.changePercent ?? 0) - Math.abs(left.changePercent ?? 0)),
    [scores]
  );

  const previewBars = rankedSignals.slice(0, 6);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--eldar-bg-primary)] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 opacity-60" style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "96px 96px"
        }} />
        <div className="absolute left-[12%] top-24 h-[420px] w-[420px] rounded-full bg-white/[0.06] blur-[140px]" />
        <div className="absolute right-[-6%] top-28 h-[540px] w-[540px] rounded-full bg-white/[0.05] blur-[180px]" />
        <div className="absolute bottom-[-14%] left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-white/[0.04] blur-[180px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_42%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.03),transparent_46%)]" />
      </div>

      <header id="top" className="relative z-10">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between px-6 py-6 md:px-10">
          <button
            type="button"
            className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-left transition hover:border-white/22 hover:bg-white/[0.05]"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Scroll to top"
          >
            <div className="relative h-[48px] w-[48px] overflow-hidden">
              <Image src={logoSrc} alt="ELDAR logo" fill sizes="48px" className="object-contain" priority />
            </div>
            <div className="hidden sm:block">
              <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/88">ELDAR</div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-white/38">Private operating surface</div>
            </div>
          </button>

          <nav aria-label="Landing sections" className="hidden items-center gap-8 lg:flex">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[12px] uppercase tracking-[0.18em] text-white/48 transition hover:text-white/78"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <SignedOut>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="eldar-btn-ghost inline-flex min-h-[44px] items-center rounded-full px-5 text-[11px] font-semibold uppercase tracking-[0.14em]"
                >
                  Sign in
                </button>
              </SignInButton>
            </SignedOut>
            <button
              type="button"
              onClick={onOpenApp}
              className="eldar-btn-silver inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-[11px] font-semibold uppercase tracking-[0.14em]"
            >
              Enter App
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-[1380px] px-6 pb-16 pt-10 md:px-10 md:pb-24 md:pt-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_560px] lg:items-center xl:gap-16">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/58">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Quietly reading the tape
              </div>

              <h1 className="mt-8 max-w-[12ch] text-[clamp(3.4rem,8vw,7.2rem)] font-semibold leading-[0.92] tracking-[-0.06em] text-white">
                The market leaves fingerprints.
              </h1>

              <p className="mt-6 max-w-[36rem] text-lg leading-8 text-white/64">
                A private surface for watching the tape before the room decides what it means.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onOpenApp}
                  className="eldar-btn-silver inline-flex min-h-[50px] items-center gap-2 rounded-full px-6 text-[12px] font-semibold uppercase tracking-[0.14em]"
                >
                  Enter App
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                {TRUST_MARKERS.map(({ label, icon: Icon }) => (
                  <span
                    key={label}
                    className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 text-[11px] uppercase tracking-[0.14em] text-white/52"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {label}
                  </span>
                ))}
              </div>

            </div>

            <div className="relative" id="surface">
              <div className="absolute -left-14 top-14 hidden h-56 w-56 rounded-full bg-white/[0.08] blur-[100px] lg:block" aria-hidden="true" />
              <div className="absolute -right-6 bottom-2 hidden h-48 w-48 rounded-full bg-white/[0.08] blur-[100px] lg:block" aria-hidden="true" />

              <div className="eldar-panel relative overflow-hidden rounded-[34px] p-5 md:p-6">
                <div className="absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.05),transparent_34%,rgba(255,255,255,0.02))]" aria-hidden="true" />
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-white/55" />
                    <span className="h-2 w-2 rounded-full bg-white/28" />
                    <span className="h-2 w-2 rounded-full bg-white/16" />
                  </div>

                  <div className="mt-6 rounded-[24px] border border-white/10 bg-black/20 p-5">
                    <div className="grid gap-3">
                      {previewBars.map((item) => {
                        const move = item.changePercent ?? 0;
                        const width = `${Math.max(18, Math.min(100, Math.abs(move) * 18))}%`;
                        return (
                          <div key={item.symbol} className="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-4">
                            <div className="h-1.5 w-1.5 rounded-full bg-white/24" />
                            <div className="h-[4px] overflow-hidden rounded-full bg-white/8">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width,
                                  background: move >= 0 ? "rgba(16,185,129,0.8)" : "rgba(239,68,68,0.82)",
                                  boxShadow: move >= 0 ? "0 0 16px rgba(16,185,129,0.24)" : "0 0 16px rgba(239,68,68,0.22)"
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="signal" className="mx-auto max-w-[1380px] px-6 pb-16 md:px-10 md:pb-24" aria-label="Core pillars">
          <div className="grid gap-5 lg:grid-cols-3">
            <InsightCard icon={Sparkles} title={PILLARS[0].title} body={PILLARS[0].body} />
            <InsightCard icon={Waypoints} title={PILLARS[1].title} body={PILLARS[1].body} />
            <InsightCard icon={BookMarked} title={PILLARS[2].title} body={PILLARS[2].body} />
          </div>
        </section>

        <section id="memory" className="mx-auto max-w-[1380px] px-6 pb-20 md:px-10 md:pb-28">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="eldar-panel rounded-[32px] p-7 md:p-9">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/38">ELDAR</div>
              <div className="mt-4 max-w-[12ch] text-[clamp(2.4rem,4vw,4.4rem)] font-semibold leading-[0.96] tracking-[-0.05em] text-white">
                Quiet by design.
              </div>
              <p className="mt-5 max-w-[34rem] text-sm leading-7 text-white/60">
                Most platforms get louder as the room gets less certain. This one does the opposite.
              </p>
            </div>

            <div className="grid gap-5">
              <div className="eldar-dashboard-surface rounded-[28px] p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[22px] font-semibold tracking-[-0.04em] text-white">
                      The surface is already awake.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenApp}
                    className="eldar-btn-silver inline-flex min-h-[48px] items-center gap-2 rounded-full px-5 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  >
                    Enter App
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
