"use client";

import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";

import type { HomeDashboardPayload } from "@/lib/home/dashboard-types";

type MacroRegime = HomeDashboardPayload["regime"];

const PILLAR_CONFIG = [
  { key: "plumbing", label: "Plumbing", weight: "40%", note: "Rule of Supremacy applies", maxContribution: 8 },
  { key: "cycle", label: "Cycle", weight: "30%", note: "Structural economic regime", maxContribution: 13 },
  { key: "sentiment", label: "Sentiment", weight: "20%", note: "Coincident market signals", maxContribution: 6 },
  { key: "defense", label: "Defense", weight: "10%", note: "Industrial vs speculative", maxContribution: 1 }
] as const;

const ALL_GATES = [
  "RULE_OF_SUPREMACY",
  "MOVE_HARD_CAP",
  "HYG_SOLVENCY_GATE",
  "SAHM_HARD_TRIGGER",
  "OIL_GATE",
  "INFLATION_OVERRIDE",
  "CRISIS_FLOOR"
] as const;

const GATE_SHORT_LABELS: Record<(typeof ALL_GATES)[number], string> = {
  RULE_OF_SUPREMACY: "Supremacy",
  MOVE_HARD_CAP: "MOVE Cap",
  HYG_SOLVENCY_GATE: "HYG Solvency",
  SAHM_HARD_TRIGGER: "Sahm Rule",
  OIL_GATE: "Oil Gate",
  INFLATION_OVERRIDE: "Inflation",
  CRISIS_FLOOR: "Crisis Floor"
};

function regimeColor(label: MacroRegime["label"]): string {
  if (label === "MAXIMUM_EXPANSION") return "#059669";
  if (label === "CONSTRUCTIVE_BIAS") return "#10B981";
  if (label === "CHOP_DISTRIBUTION") return "#6B7280";
  if (label === "DEFENSIVE_LIQUIDATION") return "#EF4444";
  return "#B91C1C";
}

function regimeLabel(label: MacroRegime["label"]): string {
  return label.replace(/_/g, " ");
}

function confidenceBadgeClass(confidence: MacroRegime["confidence"]): string {
  if (confidence === "HIGH") return "border-emerald-400/35 text-emerald-300";
  if (confidence === "LOW") return "border-red-400/35 text-red-300";
  return "border-white/15 text-white/72";
}

function gateLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function indicatorColor(score: number): string {
  if (score > 0.3) return "#10B981";
  if (score < -0.3) return "#EF4444";
  return "#6B7280";
}

function RegimeNeedle({
  score,
  regime,
  confidence,
  gatesFired,
  warnings,
  formulaScore,
  modelVersion
}: {
  score: number;
  regime: MacroRegime["label"];
  confidence: MacroRegime["confidence"];
  gatesFired: MacroRegime["gatesFired"];
  warnings: string[];
  formulaScore: number;
  modelVersion: string;
}): JSX.Element {
  const [mounted, setMounted] = useState(false);
  const pct = ((Math.max(-10, Math.min(10, score)) + 10) / 20) * 100;
  const color = regimeColor(regime);

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 20);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="bg-[#0F0F0F] border border-[#2A2A2A] p-6 w-full">
      <div className="mb-6 flex items-center justify-between gap-4">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#666]">
          Macro Regime
        </span>
        <div className="flex items-center gap-3">
          <span className={clsx("rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em]", confidenceBadgeClass(confidence))}>
            {confidence}
          </span>
          <span className="font-mono text-[9px] text-[#444]">
            {modelVersion}
          </span>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-baseline gap-4">
        <span className="font-semibold text-5xl tracking-[-0.05em]" style={{ color }}>
          {score > 0 ? "+" : ""}
          {score.toFixed(1)}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.15em]" style={{ color }}>
          {regimeLabel(regime)}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#555]">
          Formula {formulaScore > 0 ? "+" : ""}
          {formulaScore.toFixed(1)}
        </span>
      </div>

      <div className="relative mb-2 h-3 w-full overflow-hidden rounded-none">
        <div className="absolute inset-0 flex">
          <div className="h-full" style={{ width: "12.5%", background: "#B91C1C", opacity: 0.4 }} />
          <div className="h-full" style={{ width: "25%", background: "#EF4444", opacity: 0.4 }} />
          <div className="h-full bg-[#2A2A2A]" style={{ width: "25%" }} />
          <div className="h-full" style={{ width: "25%", background: "#10B981", opacity: 0.4 }} />
          <div className="h-full" style={{ width: "12.5%", background: "#059669", opacity: 0.4 }} />
        </div>

        {[-7.5, -2.5, 0, 2.5, 7.5].map((tick) => (
          <div
            key={`regime-tick-${tick}`}
            className="absolute top-0 h-full w-px bg-[#0F0F0F]"
            style={{ left: `${((tick + 10) / 20) * 100}%` }}
          />
        ))}

        <div
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-[#0F0F0F] transition-all duration-1000 ease-out"
          style={{
            left: `calc(${mounted ? pct : 50}% - 8px)`,
            background: color,
            boxShadow: `0 0 12px ${color}80`
          }}
        />
      </div>

      <div className="mt-1 flex justify-between font-mono text-[8px] text-[#444]">
        <span>-10 RISK-OFF</span>
        <span>0</span>
        <span>RISK-ON +10</span>
      </div>

      {(warnings.length > 0 || gatesFired.length > 0) && (
        <div className="mt-4 space-y-1">
          {warnings.map((warning, index) => (
            <div key={`macro-warning-${index}`} className="flex items-start gap-2 font-mono text-[10px] text-[#EF4444]">
              <span className="mt-0.5 shrink-0">!</span>
              <span>{warning}</span>
            </div>
          ))}
          {warnings.length === 0 && gatesFired.map((gate) => (
            <div key={gate.gate} className="flex items-start gap-2 font-mono text-[10px] text-[#EF4444]">
              <span className="mt-0.5 shrink-0">!</span>
              <span>{gate.effect}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PillarScoreBar({
  contribution,
  maxContribution
}: {
  contribution: number;
  maxContribution: number;
}): JSX.Element {
  const normalized = Math.max(-1, Math.min(1, contribution / maxContribution));
  const isPositive = normalized > 0;

  return (
    <div className="relative mb-1 h-1 w-full bg-[#1E1E1E]">
      <div className="absolute left-1/2 top-0 h-full w-px bg-[#2A2A2A]" />
      <div
        className="absolute top-0 h-full transition-all duration-700"
        style={{
          left: isPositive ? "50%" : `${(0.5 + normalized / 2) * 100}%`,
          width: `${Math.abs(normalized) * 50}%`,
          background: isPositive ? "#10B981" : "#EF4444",
          opacity: 0.8
        }}
      />
    </div>
  );
}

function IndicatorRow({
  indicator
}: {
  indicator: MacroRegime["pillars"]["plumbing"]["indicators"][number];
}): JSX.Element {
  const color = indicatorColor(indicator.finalScore);
  return (
    <div className="flex items-start gap-2">
      <div className="mt-1 flex shrink-0 items-center gap-1">
        <div className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="font-mono text-[8px]" style={{ color }}>
          W{indicator.weight}
        </span>
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[10px] text-[#CCC]">{indicator.name}</div>
        <div className="mt-0.5 font-mono text-[9px] leading-tight text-[#555]">{indicator.rationale}</div>
      </div>
      <div className="ml-auto shrink-0 font-mono text-[9px]" style={{ color }}>
        {indicator.finalScore > 0 ? "+" : ""}
        {indicator.finalScore.toFixed(2)}
      </div>
    </div>
  );
}

function PillarCard({
  pillarKey,
  regime
}: {
  pillarKey: (typeof PILLAR_CONFIG)[number]["key"];
  regime: MacroRegime;
}): JSX.Element {
  const config = PILLAR_CONFIG.find((item) => item.key === pillarKey)!;
  const result = regime.pillars[pillarKey];

  return (
    <div className="bg-[#0F0F0F] border border-[#2A2A2A] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#666]">
            {config.label}
          </span>
          <div className="mt-0.5 font-mono text-[8px] text-[#444]">{config.note}</div>
        </div>
        <span className="font-mono text-[9px] text-[#FFBF00]">{config.weight}</span>
      </div>

      <PillarScoreBar contribution={result.contribution} maxContribution={config.maxContribution} />

      <div className="my-3 border-t border-[#1E1E1E]" />

      <div className="space-y-2.5">
        {result.indicators.map((indicator) => (
          <IndicatorRow key={`${pillarKey}-${indicator.name}`} indicator={indicator} />
        ))}
      </div>
    </div>
  );
}

export function MacroPillarGrid({ regime }: { regime: MacroRegime }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {PILLAR_CONFIG.map((pillar) => (
        <PillarCard key={pillar.key} pillarKey={pillar.key} regime={regime} />
      ))}
    </div>
  );
}

export function MacroGateStatusRow({ gatesFired }: { gatesFired: MacroRegime["gatesFired"] }): JSX.Element {
  const firedKeys = new Set(gatesFired.map((gate) => gate.gate));

  return (
    <div className="flex flex-wrap gap-2">
      <span className="mr-1 self-center font-mono text-[9px] uppercase tracking-[0.16em] text-[#444]">
        Gates
      </span>
      {ALL_GATES.map((gate) => {
        const fired = firedKeys.has(gate);
        return (
          <div
            key={gate}
            className="px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] border"
            style={{
              borderColor: fired ? "#EF4444" : "#2A2A2A",
              color: fired ? "#EF4444" : "#444",
              background: fired ? "rgba(239,68,68,0.06)" : "transparent"
            }}
          >
            {fired ? "! " : ""}
            {GATE_SHORT_LABELS[gate]}
          </div>
        );
      })}
    </div>
  );
}

export function MacroGateExplanationList({
  gatesFired,
  warnings
}: {
  gatesFired: MacroRegime["gatesFired"];
  warnings: string[];
}): JSX.Element {
  if (gatesFired.length === 0 && warnings.length === 0) {
    return (
      <div className="rounded-2xl border border-[#2A2A2A] bg-[#0F0F0F] px-4 py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[#555]">
        No gate overrides are active.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[#2A2A2A] bg-[#0F0F0F] p-4">
      {gatesFired.map((gate) => (
        <div key={gate.gate} className="border-b border-[#1E1E1E] pb-3 last:border-b-0 last:pb-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EF4444]">{gateLabel(gate.gate)}</div>
          <div className="mt-2 font-mono text-[10px] leading-5 text-[#888]">{gate.reason}</div>
          <div className="mt-1 font-mono text-[10px] leading-5 text-[#666]">{gate.effect}</div>
        </div>
      ))}
      {warnings.map((warning, index) => (
        <div key={`warning-${index}`} className="font-mono text-[10px] leading-5 text-[#888]">
          {warning}
        </div>
      ))}
    </div>
  );
}

export function MacroRegimeNeedlePanel({ regime }: { regime: MacroRegime }): JSX.Element {
  return (
    <RegimeNeedle
      score={regime.compositeScore}
      regime={regime.label}
      confidence={regime.confidence}
      gatesFired={regime.gatesFired}
      warnings={regime.warnings}
      formulaScore={regime.formulaScore}
      modelVersion={regime.modelVersion}
    />
  );
}

export function RawDataSection({
  count,
  children
}: {
  count: number;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-[#2A2A2A]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 font-mono text-[9px] uppercase tracking-[0.16em] text-[#666] transition-colors hover:text-[#FFBF00]"
      >
        <span>Raw FRED Data - {count} Series</span>
        <span>{open ? "↑" : "↓"}</span>
      </button>

      {open ? <div className="border-t border-[#2A2A2A]">{children}</div> : null}
    </div>
  );
}
