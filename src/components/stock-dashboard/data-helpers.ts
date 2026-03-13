import type { HomeDashboardPayload, SectorRotationWindow } from "@/lib/home/dashboard-types";
import { isUsableHomeDashboardPayload } from "@/lib/home/dashboard-validators";
import type { FactorResult, Mag7ScoreCard, PersistedAnalysis } from "@/lib/types";

const LOCAL_HOME_DASHBOARD_STORAGE_PREFIX = "eldar:home:dashboard";

type IndexYtdLike<TCode extends string = string> = {
  code: TCode;
  current: number | null;
  ytdChangePercent: number | null;
  asOf: string | null;
  points: number[];
  pointDates: string[];
};

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function homeDashboardStorageKey(windowKey: SectorRotationWindow): string {
  return `${LOCAL_HOME_DASHBOARD_STORAGE_PREFIX}:${windowKey}`;
}

export function readCachedHomeDashboard(windowKey: SectorRotationWindow): HomeDashboardPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const key = homeDashboardStorageKey(windowKey);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { payload?: HomeDashboardPayload };
    if (!isUsableHomeDashboardPayload(parsed.payload ?? null)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

export function writeCachedHomeDashboard(payload: HomeDashboardPayload): void {
  if (typeof window === "undefined") return;
  if (!isUsableHomeDashboardPayload(payload)) return;
  try {
    window.sessionStorage.setItem(
      homeDashboardStorageKey(payload.sectorWindow),
      JSON.stringify({ storedAt: Date.now(), payload })
    );
  } catch {
    // Session storage writes are optional.
  }
}

export function mergeIndexRows<T extends IndexYtdLike>(primary: T[], fallback: T[], baseline: T[]): T[] {
  const fallbackByCode = new Map(fallback.map((item) => [item.code, item]));
  const primaryByCode = new Map(primary.map((item) => [item.code, item]));
  const baselineByCode = new Map(baseline.map((item) => [item.code, item]));

  return baseline.map((base) => {
    const code = base.code;
    const next = primaryByCode.get(code);
    const previous = fallbackByCode.get(code);

    if (!next && previous) return previous;
    if (!next) {
      return baselineByCode.get(code) ?? base;
    }

    return {
      ...next,
      current: next.current ?? previous?.current ?? null,
      ytdChangePercent: next.ytdChangePercent ?? previous?.ytdChangePercent ?? null,
      asOf: next.asOf ?? previous?.asOf ?? null,
      points: next.points.length > 0 ? next.points : previous?.points ?? [],
      pointDates: next.pointDates.length > 0 ? next.pointDates : previous?.pointDates ?? []
    };
  });
}

function extractFirstNumeric(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function findFactorMatch(
  factors: PersistedAnalysis["factors"],
  factorNames: string[]
): PersistedAnalysis["factors"][number] | null {
  for (const factorName of factorNames) {
    const match = factors.find((factor) => factor.factor === factorName);
    if (match) {
      return match;
    }
  }
  return null;
}

export function findFactorMetric(
  factors: PersistedAnalysis["factors"],
  factorName: string,
  fallbackFactorNames: string[] = []
): number | null {
  const match = findFactorMatch(factors, [factorName, ...fallbackFactorNames]);
  return extractFirstNumeric(match?.metricValue ?? null);
}

export function findFactorSignal(
  factors: PersistedAnalysis["factors"],
  factorName: string,
  fallbackFactorNames: string[] = []
): FactorResult["signal"] | null {
  const match = findFactorMatch(factors, [factorName, ...fallbackFactorNames]);
  return match?.signal ?? null;
}

export function factorSignalToneClass(signal: FactorResult["signal"] | null): string {
  if (signal === "BULLISH") return "text-emerald-300";
  if (signal === "BEARISH") return "text-red-300";
  return "text-white/75";
}

export function formatSignedPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

export function ratioToPercentPoints(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value * 100;
}

export function factorActionHint(factorName: string): string {
  if (factorName.includes("EPS Estimate Revision")) return "EPS revision needs to turn positive";
  if (factorName.includes("Price vs 200SMA")) return "Momentum needs to recover above 200SMA";
  if (factorName.includes("52w Relative Strength")) return "Relative strength vs sector needs to improve";
  if (factorName.includes("EV/EBITDA")) return "Valuation needs to normalize versus sector peers";
  if (factorName.includes("Debt/Equity")) return "Leverage profile needs to improve";
  if (factorName.includes("Short Interest")) return "Short-interest pressure needs to cool";
  return `${factorName} needs to improve`;
}

export function sectorRelativeState(vsSectorPercent: number | null): {
  arrow: string;
  value: string;
  label: "LEADING" | "LAGGING" | "IN LINE";
  toneClass: string;
} {
  if (typeof vsSectorPercent !== "number" || !Number.isFinite(vsSectorPercent)) {
    return {
      arrow: "•",
      value: "N/A",
      label: "IN LINE",
      toneClass: "text-white/55"
    };
  }

  if (vsSectorPercent >= 1) {
    return {
      arrow: "▲",
      value: formatSignedPercent(vsSectorPercent, 1),
      label: "LEADING",
      toneClass: "text-emerald-300"
    };
  }

  if (vsSectorPercent <= -1) {
    return {
      arrow: "▼",
      value: formatSignedPercent(vsSectorPercent, 1),
      label: "LAGGING",
      toneClass: "text-red-300"
    };
  }

  return {
    arrow: "•",
    value: formatSignedPercent(vsSectorPercent, 1),
    label: "IN LINE",
    toneClass: "text-white/55"
  };
}

export function areMag7CardsEqual(a: Mag7ScoreCard[], b: Mag7ScoreCard[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];

    if (left.symbol !== right.symbol || left.rating !== right.rating || Math.abs(left.score - right.score) > 0.001) {
      return false;
    }

    if (Math.abs(left.currentPrice - right.currentPrice) > 0.001) {
      return false;
    }

    const leftChange = left.changePercent ?? null;
    const rightChange = right.changePercent ?? null;
    if (leftChange === null && rightChange === null) {
      continue;
    }

    if (leftChange === null || rightChange === null || Math.abs(leftChange - rightChange) > 0.001) {
      return false;
    }
  }
  return true;
}
