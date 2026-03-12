"use client";

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import { useMemo } from "react";
import { ArrowRight, ArrowUpRight, Check, CircleHelp, ShieldCheck, Sparkles } from "lucide-react";

import type { Mag7ScoreCard } from "@/lib/types";

interface HeroLandingProps {
  logoSrc: string;
  scores: Mag7ScoreCard[];
  onOpenApp: () => void;
}

const NAV_ITEMS = [
  { label: "Benefits", href: "#benefits" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" }
] as const;

const TRUST_BADGES = ["S&P 500 coverage", "Snapshot-first reads", "Live + fallback market data"] as const;

const PARTNERS = ["Bloomberg", "Reuters", "NYSE", "Nasdaq", "CBOE", "FRED", "SEC"] as const;

const BENEFITS = [
  {
    title: "See regime before noise",
    body: "Macro, tape, and fundamentals are fused into one operational surface so you can decide faster."
  },
  {
    title: "Consistent rating contract",
    body: "Every symbol follows the same scoring framework, with visible factor lineage and stable semantics."
  },
  {
    title: "Institutional data fallback",
    body: "If one provider fails, ranked fallback chains preserve continuity instead of returning blank states."
  },
  {
    title: "Snapshot-first performance",
    body: "User routes read from precomputed snapshots so heavy upstream calls do not block core UI paths."
  },
  {
    title: "Auditable fundamentals",
    body: "SEC parsing keeps period alignment, amendment handling, and warnings for suspicious filings."
  },
  {
    title: "Unified watch workflow",
    body: "From discovery to watchlist to score context, you stay on one coherent rail with less switching."
  }
] as const;

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Pick a ticker",
    body: "Search any covered symbol and get a complete market + fundamentals context snapshot."
  },
  {
    step: "02",
    title: "Read the signal",
    body: "See score, factor breakdown, macro bias, and key risk gates in one place."
  },
  {
    step: "03",
    title: "Act with discipline",
    body: "Save to watchlist, compare alternatives, and re-check as new data snapshots arrive."
  }
] as const;

const PRICING = [
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    blurb: "For solo operators",
    features: ["Single-user workspace", "Core rating engine", "Watchlist + history"],
    highlight: false
  },
  {
    name: "Pro",
    price: "$99",
    period: "/month",
    blurb: "For active decision loops",
    features: ["Everything in Starter", "Advanced snapshots", "Priority refresh + exports"],
    highlight: true
  },
  {
    name: "Desk",
    price: "$299",
    period: "/month",
    blurb: "For small teams",
    features: ["Everything in Pro", "Multi-user workflows", "Operational support"],
    highlight: false
  }
] as const;

const FAQ = [
  {
    q: "How fresh is the data?",
    a: "Quotes refresh frequently, while fundamentals and scores use cache windows that match their natural update cadence."
  },
  {
    q: "What happens if a provider fails?",
    a: "Fallback layers and snapshots serve last-known-good data while background refresh jobs recover upstream gaps."
  },
  {
    q: "Is this built for hype trading?",
    a: "No. The interface is optimized for structured decision-making, not dopamine loops."
  },
  {
    q: "Can I use it before connecting external accounts?",
    a: "Yes. You can run the platform with your configured market providers and SEC/FRED ingestion stack."
  }
] as const;

function signedMove(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function moveTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "var(--eldar-text-muted)";
  return value >= 0 ? "#10b981" : "#ef4444";
}

function scoreBarWidth(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "24%";
  return `${Math.max(16, Math.min(100, Math.abs(value) * 16))}%`;
}

export function HeroLanding({ logoSrc, scores, onOpenApp }: HeroLandingProps): JSX.Element {
  const movers = useMemo(
    () =>
      scores
        .slice()
        .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
        .slice(0, 6),
    [scores]
  );

  const testimonials = useMemo(
    () =>
      movers.slice(0, 3).map((item, index) => ({
        id: `${item.symbol}-${index}`,
        quote:
          index === 0
            ? "It cut my pre-market scan time by more than half."
            : index === 1
              ? "The snapshot flow is clean: read, decide, move on."
              : "Finally a terminal-like surface that stays calm under pressure.",
        author: item.companyName,
        role: `${item.symbol} tracked signal`
      })),
    [movers]
  );

  return (
    <div className="min-h-screen bg-[var(--eldar-bg-primary)] text-[var(--eldar-text-primary)]">
      <header
        className="sticky top-0 z-50 border-b border-[var(--eldar-border-default)] backdrop-blur"
        style={{ backgroundColor: "color-mix(in srgb, var(--eldar-bg-primary) 88%, transparent)" }}
      >
        <div className="mx-auto flex w-full max-w-[1220px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#hero" className="flex items-center gap-3" aria-label="Back to hero">
            <div className="relative h-10 w-10 overflow-hidden rounded-full border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)]">
              <Image src={logoSrc} alt="ELDAR" fill sizes="40px" className="object-contain" priority />
            </div>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em]">ELDAR</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--eldar-text-muted)]">Market Intelligence</div>
            </div>
          </a>

          <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[11px] uppercase tracking-[0.14em] text-[var(--eldar-text-secondary)] transition hover:text-[var(--eldar-text-primary)]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <SignedOut>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="eldar-btn-ghost inline-flex min-h-[40px] items-center rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.14em]"
                >
                  Sign in
                </button>
              </SignInButton>
            </SignedOut>
            <button
              type="button"
              onClick={onOpenApp}
              className="eldar-btn-silver inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.14em]"
            >
              Enter App
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1220px] space-y-14 px-4 pb-24 pt-8 sm:px-6 lg:space-y-20 lg:px-8 lg:pt-12">
        <section
          id="hero"
          className="scroll-mt-24 grid gap-8 rounded-3xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)] p-6 md:grid-cols-[minmax(0,1fr)_460px] md:p-9"
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--eldar-text-secondary)]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              1,200+ active users
            </div>

            <h1 className="mt-6 max-w-[16ch] text-[clamp(2.05rem,5vw,3.6rem)] font-semibold leading-[1.01] tracking-[-0.045em]">
              High-conviction stock intelligence without interface noise.
            </h1>

            <p className="mt-4 max-w-[56ch] text-sm leading-7 text-[var(--eldar-text-secondary)] sm:text-base">
              Track macro regime, score quality, and market tape in one structured surface. Read faster, decide cleaner, and stay
              consistent across symbols.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onOpenApp}
                className="eldar-btn-silver inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-[11px] font-semibold uppercase tracking-[0.14em]"
              >
                Open Terminal
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <a
                href="#how"
                className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--eldar-border-default)] px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--eldar-text-secondary)] transition hover:text-[var(--eldar-text-primary)]"
              >
                How it works
              </a>
            </div>

            <div className="mt-7 flex flex-wrap gap-2.5">
              {TRUST_BADGES.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)] px-3 py-1 text-[11px] text-[var(--eldar-text-secondary)]"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)] p-5">
            <div className="mb-3 text-[11px] uppercase tracking-[0.14em] text-[var(--eldar-text-muted)]">Live market surface</div>
            <div className="space-y-3 rounded-xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-primary)] p-4">
              {movers.length > 0 ? (
                movers.map((item) => (
                  <article key={item.symbol} className="grid grid-cols-[68px_1fr_auto] items-center gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">{item.symbol}</div>
                    <div className="h-[6px] rounded-full" style={{ backgroundColor: "rgba(163,163,163,0.24)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: scoreBarWidth(item.changePercent),
                          backgroundColor: moveTone(item.changePercent)
                        }}
                      />
                    </div>
                    <div className="text-[11px] font-semibold" style={{ color: moveTone(item.changePercent) }}>
                      {signedMove(item.changePercent)}
                    </div>
                  </article>
                ))
              ) : (
                <div className="py-10 text-center text-sm text-[var(--eldar-text-muted)]">Loading signal preview…</div>
              )}
            </div>
            <div className="mt-4 text-[11px] text-[var(--eldar-text-muted)]">Preview built from current ranked movers.</div>
          </div>
        </section>

        <section id="partners" className="scroll-mt-24 rounded-3xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)] p-6 md:p-8">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--eldar-text-muted)]">Trusted data surfaces</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {PARTNERS.map((partner) => (
              <div
                key={partner}
                className="rounded-xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)] px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--eldar-text-secondary)]"
              >
                {partner}
              </div>
            ))}
          </div>
        </section>

        <section id="benefits" className="scroll-mt-24 rounded-3xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)] p-6 md:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Benefits</h2>
          <p className="mt-2 text-sm text-[var(--eldar-text-secondary)]">Focus on decision quality, not visual noise.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <article
                key={benefit.title}
                className="rounded-2xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)] p-4 transition hover:border-[var(--eldar-amber-border)]"
              >
                <div className="text-base font-semibold tracking-[-0.01em]">{benefit.title}</div>
                <p className="mt-2 text-sm leading-6 text-[var(--eldar-text-secondary)]">{benefit.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="scroll-mt-24 rounded-3xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)] p-6 md:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">How it works</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {HOW_IT_WORKS.map((step) => (
              <article
                key={step.step}
                className="rounded-2xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)] p-4 transition hover:border-[var(--eldar-amber-border)]"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--eldar-text-muted)]">Step {step.step}</div>
                <div className="mt-2 text-lg font-semibold tracking-[-0.01em]">{step.title}</div>
                <p className="mt-2 text-sm leading-6 text-[var(--eldar-text-secondary)]">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="pricing" className="scroll-mt-24 rounded-3xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)] p-6 md:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Pricing</h2>
          <p className="mt-2 text-sm text-[var(--eldar-text-secondary)]">Pick the plan that matches your decision cadence.</p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {PRICING.map((plan) => (
              <article
                key={plan.name}
                className={`rounded-2xl border p-4 ${
                  plan.highlight
                    ? "border-[var(--eldar-amber-border)] bg-[var(--eldar-bg-primary)]"
                    : "border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold uppercase tracking-[0.12em]">{plan.name}</div>
                  {plan.highlight ? (
                    <span className="rounded-full border border-[var(--eldar-amber-border)] bg-[var(--eldar-bg-surface)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                      Most Popular
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-3xl font-semibold tracking-[-0.03em]">{plan.price}</span>
                  <span className="pb-1 text-sm text-[var(--eldar-text-secondary)]">{plan.period}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--eldar-text-secondary)]">{plan.blurb}</p>
                <button
                  type="button"
                  onClick={onOpenApp}
                  className="mt-4 w-full rounded-full border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-primary)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
                >
                  Start now
                </button>
                <ul className="mt-4 space-y-2 text-sm text-[var(--eldar-text-secondary)]">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="testimonials" className="scroll-mt-24 rounded-3xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)] p-6 md:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Loved by operators worldwide</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {testimonials.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)] p-4 transition hover:border-[var(--eldar-amber-border)]"
              >
                <div className="text-[13px] leading-6 text-[var(--eldar-text-secondary)]">“{item.quote}”</div>
                <div className="mt-4 text-sm font-semibold">{item.author}</div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--eldar-text-muted)]">{item.role}</div>
              </article>
            ))}
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 rounded-3xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-surface)] p-6 md:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">Frequently asked questions</h2>
          <div className="mt-5 space-y-2">
            {FAQ.map((item) => (
              <details key={item.q} className="rounded-xl border border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold">
                  <span>{item.q}</span>
                  <CircleHelp className="h-4 w-4 shrink-0 text-[var(--eldar-text-muted)]" aria-hidden="true" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-[var(--eldar-text-secondary)]">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--eldar-amber-border)] bg-[var(--eldar-bg-raised)] p-6 md:p-8" id="cta">
          <div className="max-w-[58ch]">
            <h2 className="text-2xl font-semibold tracking-[-0.02em] md:text-3xl">Build conviction before the room catches up.</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--eldar-text-secondary)]">
              Open ELDAR and work through the same disciplined read path on every symbol.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onOpenApp}
              className="eldar-btn-silver inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-[11px] font-semibold uppercase tracking-[0.14em]"
            >
              Enter App
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
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
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--eldar-border-default)] bg-[var(--eldar-bg-secondary)]">
        <div className="mx-auto grid w-full max-w-[1220px] gap-6 px-4 py-8 sm:px-6 md:grid-cols-4 lg:px-8">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em]">ELDAR</div>
            <p className="mt-2 text-sm text-[var(--eldar-text-secondary)]">Structured market intelligence for disciplined operators.</p>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--eldar-text-muted)]">Menu</div>
            <div className="mt-2 space-y-1 text-sm text-[var(--eldar-text-secondary)]">
              {NAV_ITEMS.map((item) => (
                <a key={item.href} href={item.href} className="block hover:text-[var(--eldar-text-primary)]">
                  {item.label}
                </a>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--eldar-text-muted)]">Legal</div>
            <div className="mt-2 space-y-1 text-sm text-[var(--eldar-text-secondary)]">
              <span className="block">Privacy</span>
              <span className="block">Terms</span>
              <span className="block">Security</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--eldar-text-muted)]">Status</div>
            <p className="mt-2 text-sm text-[var(--eldar-text-secondary)]">Live snapshots, fallback providers, and SEC-backed fundamentals.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
