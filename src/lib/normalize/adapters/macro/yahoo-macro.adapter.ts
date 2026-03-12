import { AdapterError, defaultProvenance, parseDateOnly } from "@/lib/normalize/adapters/_utils";
import { checkMacroValue } from "@/lib/normalize/resolver/sanity-checker";
import type {
  CanonicalMacroSeries,
  CanonicalObservation,
  MacroFrequency,
  MacroUnit
} from "@/lib/normalize/types/canonical";
import type { YahooMacroObservationRaw } from "@/lib/normalize/types/providers";

const YAHOO_MACRO_CONFIG: Record<string, { name: string; unit: MacroUnit; frequency: MacroFrequency }> = {
  MOVE: { name: "MOVE Index", unit: "index", frequency: "daily" },
  VIX: { name: "VIX", unit: "index", frequency: "daily" },
  DXY: { name: "DXY", unit: "index", frequency: "daily" },
  WTI: { name: "WTI", unit: "usd", frequency: "daily" },
  CU_AU_RATIO: { name: "Copper/Gold Ratio", unit: "ratio", frequency: "daily" }
};

export function normalizeYahooMacroSeries(
  seriesId: string,
  rawObservations: YahooMacroObservationRaw[],
  fetchedAt: string
): CanonicalMacroSeries {
  const config = YAHOO_MACRO_CONFIG[seriesId] ?? {
    name: seriesId,
    unit: "index" as MacroUnit,
    frequency: "daily" as MacroFrequency
  };

  const warnings: string[] = [];

  const observations: CanonicalObservation[] = [];
  for (const obs of rawObservations) {
    const date = parseDateOnly(obs.date);
    if (!date || obs.value == null || !Number.isFinite(obs.value)) continue;

    const check = checkMacroValue(seriesId, obs.value);
    if (!check.ok || check.value == null) {
      warnings.push(`${seriesId} ${date}: ${check.reason ?? "invalid"}`);
      continue;
    }

    observations.push({
      date,
      value: check.value,
      revised: false
    });
  }

  observations.sort((a, b) => a.date.localeCompare(b.date));

  if (observations.length === 0) {
    throw new AdapterError(`Yahoo macro ${seriesId}: no valid observations after normalization`);
  }

  return {
    seriesId,
    name: config.name,
    unit: config.unit,
    frequency: config.frequency,
    observations,
    latest: observations[observations.length - 1],
    meta: defaultProvenance("yahoo_macro", fetchedAt, { warnings })
  };
}
