import { AdapterError, defaultProvenance } from "@/lib/normalize/adapters/_utils";
import { checkMacroValue } from "@/lib/normalize/resolver/sanity-checker";
import type {
  CanonicalMacroSeries,
  CanonicalObservation,
  MacroFrequency,
  MacroUnit
} from "@/lib/normalize/types/canonical";
import type { FREDResponseRaw } from "@/lib/normalize/types/providers";

export function normalizeFRED(raw: FREDResponseRaw, seriesId: string, fetchedAt: string): CanonicalMacroSeries {
  const unit = fredUnitsToCanonical(seriesId);
  const frequency = fredFrequencyToCanonical(raw.seriess?.[0]?.frequency ?? "Monthly");

  const warnings: string[] = [];

  const observations: CanonicalObservation[] = [];
  for (const obs of raw.observations) {
    if (obs.value === "." || obs.value === "" || obs.value === "ND") continue;

    const parsed = Number.parseFloat(obs.value);
    if (!Number.isFinite(parsed)) continue;

    const value = fredConvertValue(seriesId, parsed);
    const checked = checkMacroValue(seriesId, value);
    if (!checked.ok || checked.value == null) {
      warnings.push(`${seriesId} ${obs.date}: ${checked.reason ?? "invalid"}`);
      continue;
    }

    observations.push({
      date: obs.date,
      value: checked.value,
      revised: false
    });
  }

  observations.sort((a, b) => a.date.localeCompare(b.date));

  if (observations.length === 0) {
    throw new AdapterError(`FRED ${seriesId}: no valid observations after filtering`);
  }

  return {
    seriesId,
    name: fredSeriesName(seriesId),
    unit,
    frequency,
    observations,
    latest: observations[observations.length - 1],
    meta: defaultProvenance("fred", fetchedAt, { warnings })
  };
}

export function fredConvertValue(seriesId: string, raw: number): number {
  if (seriesId === "BAMLH0A0HYM2") return raw * 100;
  return raw;
}

function fredUnitsToCanonical(seriesId: string): MacroUnit {
  const map: Record<string, MacroUnit> = {
    BAMLH0A0HYM2: "bps",
    DFII10: "percent",
    T10Y2Y: "percent",
    SAHMREALTIME: "percent",
    CPIAUCSL: "index",
    UNRATE: "percent"
  };

  return map[seriesId] ?? "index";
}

function fredFrequencyToCanonical(freq: string): MacroFrequency {
  const f = freq.toLowerCase();
  if (f.includes("daily")) return "daily";
  if (f.includes("weekly")) return "weekly";
  if (f.includes("quarter")) return "quarterly";
  return "monthly";
}

function fredSeriesName(id: string): string {
  const names: Record<string, string> = {
    BAMLH0A0HYM2: "HYG OAS (High Yield Spread)",
    DFII10: "10Y Real Yield (TIPS)",
    T10Y2Y: "Yield Curve (10Y-2Y)",
    SAHMREALTIME: "Sahm Rule Indicator",
    CPIAUCSL: "CPI (All Urban Consumers)",
    UNRATE: "Unemployment Rate",
    FEDFUNDS: "Federal Funds Rate"
  };

  return names[id] ?? id;
}
