"use client";

// AI CONTEXT TRACE
// This component owns the pre-app landing experience for StockDashboard's !isAppOpen branch.
// It is intentionally more cinematic and selective than the in-app dashboard: the goal is to signal
// taste, trust, and momentum without dumping the full product model before the user enters the app.
// It consumes the existing Mag7 score payload from app/page.tsx so the page feels live without adding
// another fetch path or slowing down the manual "Enter Terminal" transition.

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import clsx from "clsx";
import Image from "next/image";
import { useMemo, useRef } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BookMarked,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Sparkles,
  Waypoints
} from "lucide-react";

import { ratingColor, ratingDisplayLabel } from "@/lib/rating";
import type { Mag7ScoreCard, RatingLabel } from "@/lib/types";
import { formatPrice } from "@/lib/utils";

interface HeroLandingProps {
  logoSrc: string;
  scores: Mag7ScoreCard[];
  onOpenApp: () => void;
}

interface Descriptor {
  label: string;
  note: string;
}

const NAV_ITEMS = [
  { label: "Signal", href: "#signal" },
  { label: "Surface", href: "#surface" },
  { label: "Memory", href: "#memory" }
] as const;

const TRUST_MARKERS = [
  { label: "Private workspace", icon: LockKeyhole },
  { label: "Live market data", icon: Radar },
  { label: "11 sectors watched", icon: ShieldCheck }
] as const;

const PILLARS = [
  {
    id: "signal",
    title: "Signal before story.",
    body: "The tape rarely explains itself in time. The surface should."
  },
  {
    id: "surface",
    title: "Context before conviction.",
    body: "A move means less without regime, rotation, and pressure behind it."
  },
  {
    id: "memory",
    title: "Memory before hindsight.",
    body: "Good decisions deserve a frozen record before the trade rewrites itself."
  }
] as const;

function descriptorForRating(rating: RatingLabel): Descriptor {
  switch (rating) {
    case "STRONG_BUY":
      return { label: "Pressure building", note: "buyers still leaning in" };
    case "BUY":
      return { label: "Constructive", note: "flow remains supportive" };
    case "HOLD":
      return { label: "Waiting", note: "no clean edge yet" };
    case "SELL":
      return { label: "Fracturing", note: "pressure starting to show" };
    case "STRONG_SELL":
    default:
      return { label: "Breaking", note: "risk is leading the tape" };
  }
}

function percentText(value: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function toneClasses(rating: RatingLabel): string {
  switch (rating) {
    case "STRONG_BUY":
      return "border-[#FFBF00]/35 bg-[#FFBF00]/12 text-[#FFBF00]";
    case "BUY":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
    case "HOLD":
      return "border-white/14 bg-white/[0.04] text-white/72";
    case "SELL":
      return "border-red-400/30 bg-red-400/10 text-red-300";
    case "STRONG_SELL":
    default:
      return "border-red-500/40 bg-red-500/12 text-red-200";
  }
}

function LiveSignalRow({ item }: { item: Mag7ScoreCard }): JSX.Element {
  const descriptor = descriptorForRating(item.rating);
  const moveUp = (item.changePercent ?? 0) >= 0;
  const barWidth = `${Math.max(18, Math.min(100, item.score * 10))}%`;

  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_80px] items-center gap-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white">{item.symbol}</div>
        <div className="truncate text-[11px] text-white/42">{item.companyName}</div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "inline-flex min-h-[24px] items-center rounded-full border px-2.5 text-[10px] font-medium uppercase tracking-[0.12em]",
              toneClasses(item.rating)
            )}
          >
            {descriptor.label}
          </span>
          <span className="truncate text-[11px] uppercase tracking-[0.1em] text-white/36">
            {ratingDisplayLabel(item.rating)}
          </span>
        </div>
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full"
            style={{
              width: barWidth,
              backgroundColor: ratingColor(item.rating),
              boxShadow: `0 0 16px ${ratingColor(item.rating)}55`
            }}
          />
        </div>
      </div>
      <div className="text-right">
        <div className="text-[12px] font-medium text-white">{formatPrice(item.currentPrice, "USD")}</div>
        <div className={clsx("mt-1 text-[11px] font-medium", moveUp ? "text-emerald-300" : "text-red-300")}>
          {percentText(item.changePercent)}
        </div>
      </div>
    </div>
  );
}

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
  const previewRef = useRef<HTMLDivElement | null>(null);

  const rankedSignals = useMemo(
    () => scores.slice().sort((left, right) => right.score - left.score),
    [scores]
  );

  const primarySignals = rankedSignals.slice(0, 5);
  const strongestSignal = rankedSignals[0] ?? null;
  const weakestSignal = rankedSignals[rankedSignals.length - 1] ?? null;
  const averageScore =
    rankedSignals.length > 0
      ? rankedSignals.reduce((sum, item) => sum + item.score, 0) / rankedSignals.length
      : 5;
  const surfaceState = descriptorForRating(
    averageScore >= 7.9
      ? "STRONG_BUY"
      : averageScore >= 6.3
        ? "BUY"
        : averageScore >= 4.1
          ? "HOLD"
          : averageScore >= 2.7
            ? "SELL"
            : "STRONG_SELL"
  );

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
              Enter terminal
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
                Read the shift before it becomes consensus. ELDAR is a darker, calmer surface for signal,
                regime, rotation, and the pressure that price only reveals after the fact.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onOpenApp}
                  className="eldar-btn-silver inline-flex min-h-[50px] items-center gap-2 rounded-full px-6 text-[12px] font-semibold uppercase tracking-[0.14em]"
                >
                  Enter terminal
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="eldar-btn-ghost inline-flex min-h-[50px] items-center gap-2 rounded-full px-6 text-[12px] font-semibold uppercase tracking-[0.14em]"
                >
                  See the surface
                  <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
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

              <div className="mt-12 grid gap-4 md:grid-cols-3">
                <div className="eldar-dashboard-muted-surface rounded-[22px] p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Surface state</div>
                  <div className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-white">
                    {surfaceState.label}
                  </div>
                  <div className="mt-2 text-[12px] text-white/50">{surfaceState.note}</div>
                </div>
                <div className="eldar-dashboard-muted-surface rounded-[22px] p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Strongest pressure</div>
                  <div className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-white">
                    {strongestSignal?.symbol ?? "--"}
                  </div>
                  <div className="mt-2 text-[12px] text-white/50">
                    {strongestSignal ? descriptorForRating(strongestSignal.rating).label : "Waiting for the tape"}
                  </div>
                </div>
                <div className="eldar-dashboard-muted-surface rounded-[22px] p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Softest tape</div>
                  <div className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-white">
                    {weakestSignal?.symbol ?? "--"}
                  </div>
                  <div className="mt-2 text-[12px] text-white/50">
                    {weakestSignal ? descriptorForRating(weakestSignal.rating).label : "No read yet"}
                  </div>
                </div>
              </div>
            </div>

            <div ref={previewRef} className="relative" id="surface">
              <div className="absolute -left-14 top-14 hidden h-56 w-56 rounded-full bg-white/[0.08] blur-[100px] lg:block" aria-hidden="true" />
              <div className="absolute -right-6 bottom-2 hidden h-48 w-48 rounded-full bg-white/[0.08] blur-[100px] lg:block" aria-hidden="true" />

              <div className="eldar-panel relative overflow-hidden rounded-[34px] p-5 md:p-6">
                <div className="absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.05),transparent_34%,rgba(255,255,255,0.02))]" aria-hidden="true" />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/38">Live surface</div>
                      <div className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-white">The tape, arranged.</div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/44">
                      Mag 7 snapshot
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    {primarySignals.map((item) => (
                      <LiveSignalRow key={item.symbol} item={item} />
                    ))}
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Pressure map</div>
                      <div className="mt-4 flex h-28 items-end gap-3">
                        {rankedSignals.slice(0, 6).map((item) => (
                          <div key={item.symbol} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                            <div className="flex h-full w-full items-end">
                              <div
                                className="w-full rounded-t-[14px]"
                                style={{
                                  height: `${Math.max(22, item.score * 10)}%`,
                                  background: `${ratingColor(item.rating)}cc`,
                                  boxShadow: `0 0 24px ${ratingColor(item.rating)}33`
                                }}
                              />
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.14em] text-white/42">{item.symbol}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">What stays hidden</div>
                      <div className="mt-4 space-y-4">
                        <div className="flex items-start gap-3">
                          <Waypoints className="mt-0.5 h-4 w-4 text-white/44" aria-hidden="true" />
                          <div>
                            <div className="text-[13px] font-medium text-white/86">Rotation changes the meaning.</div>
                            <div className="mt-1 text-[12px] leading-6 text-white/50">
                              Strength without context is usually just noise wearing confidence.
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Radar className="mt-0.5 h-4 w-4 text-white/44" aria-hidden="true" />
                          <div>
                            <div className="text-[13px] font-medium text-white/86">Quiet surfaces make faster decisions.</div>
                            <div className="mt-1 text-[12px] leading-6 text-white/50">
                              No feed, no theater, no drag between the read and the action.
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <BookMarked className="mt-0.5 h-4 w-4 text-white/44" aria-hidden="true" />
                          <div>
                            <div className="text-[13px] font-medium text-white/86">The original read matters.</div>
                            <div className="mt-1 text-[12px] leading-6 text-white/50">
                              Decisions are cleaner when the entry signal stays frozen after the trade begins.
                            </div>
                          </div>
                        </div>
                      </div>
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
                Less noise. More asymmetry.
              </div>
              <p className="mt-5 max-w-[34rem] text-sm leading-7 text-white/60">
                Most platforms make finance louder. This one is built to make the important part stand still long
                enough for you to act on it.
              </p>
            </div>

            <div className="grid gap-5">
              <div className="eldar-dashboard-surface rounded-[28px] p-6">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Live tape</div>
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <div className="text-[22px] font-semibold tracking-[-0.04em] text-white">
                      {strongestSignal?.symbol ?? "--"}
                    </div>
                    <div className="mt-1 text-[12px] uppercase tracking-[0.12em] text-white/42">
                      {strongestSignal ? descriptorForRating(strongestSignal.rating).label : "waiting"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] text-white/70">
                      {strongestSignal ? formatPrice(strongestSignal.currentPrice, "USD") : "--"}
                    </div>
                    <div
                      className={clsx(
                        "mt-1 inline-flex items-center gap-1 text-[11px] font-medium",
                        (strongestSignal?.changePercent ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"
                      )}
                    >
                      {(strongestSignal?.changePercent ?? 0) >= 0 ? (
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {percentText(strongestSignal?.changePercent ?? null)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="eldar-dashboard-surface rounded-[28px] p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Enter when ready</div>
                    <div className="mt-2 text-[22px] font-semibold tracking-[-0.04em] text-white">
                      The surface is already awake.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenApp}
                    className="eldar-btn-silver inline-flex min-h-[48px] items-center gap-2 rounded-full px-5 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  >
                    Enter terminal
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
