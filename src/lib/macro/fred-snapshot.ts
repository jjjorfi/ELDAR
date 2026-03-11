import { getDashboardMacroRegime } from "@/lib/home/dashboard-macro";
import type { HomeDashboardPayload } from "@/lib/home/dashboard-types";

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

type ChangeMode = "yoy_pct" | "qoq_pct" | "mom_pct" | "delta_pp" | "delta_abs";

interface MacroIndicatorDefinition {
  key: string;
  title: string;
  seriesId: string;
  unit: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  changeMode: ChangeMode;
}

interface FredObservation {
  date: string;
  value: string;
}

interface FredObservationResponse {
  observations?: FredObservation[];
}

export interface MacroIndicatorSnapshot {
  key: string;
  title: string;
  seriesId: string;
  unit: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  value: number | null;
  date: string | null;
  change: number | null;
  changeMode: ChangeMode;
}

export interface MacroFredPayload {
  indicators: MacroIndicatorSnapshot[];
  fetchedAt: string;
  macroRegime: HomeDashboardPayload["regime"] | null;
}

const INDICATORS: MacroIndicatorDefinition[] = [
  {
    key: "cpi_headline",
    title: "CPI (Headline)",
    seriesId: "CPIAUCSL",
    unit: "Index",
    frequency: "monthly",
    changeMode: "yoy_pct"
  },
  {
    key: "cpi_core",
    title: "CPI (Core)",
    seriesId: "CPILFESL",
    unit: "Index",
    frequency: "monthly",
    changeMode: "yoy_pct"
  },
  {
    key: "pce_headline",
    title: "PCE (Headline)",
    seriesId: "PCEPI",
    unit: "Index",
    frequency: "monthly",
    changeMode: "yoy_pct"
  },
  {
    key: "gdp_nominal",
    title: "GDP (Nominal)",
    seriesId: "GDP",
    unit: "Billions USD",
    frequency: "quarterly",
    changeMode: "qoq_pct"
  },
  {
    key: "gdp_real",
    title: "GDP (Real)",
    seriesId: "GDPC1",
    unit: "Billions Chained USD",
    frequency: "quarterly",
    changeMode: "qoq_pct"
  },
  {
    key: "unemployment_rate",
    title: "Unemployment Rate",
    seriesId: "UNRATE",
    unit: "%",
    frequency: "monthly",
    changeMode: "delta_pp"
  },
  {
    key: "fed_funds_rate",
    title: "Fed Funds Rate",
    seriesId: "FEDFUNDS",
    unit: "%",
    frequency: "monthly",
    changeMode: "delta_pp"
  },
  {
    key: "us10y_yield",
    title: "US 10Y Treasury Yield",
    seriesId: "DGS10",
    unit: "%",
    frequency: "daily",
    changeMode: "delta_pp"
  },
  {
    key: "nonfarm_payrolls",
    title: "Nonfarm Payrolls",
    seriesId: "PAYEMS",
    unit: "Thousands",
    frequency: "monthly",
    changeMode: "delta_abs"
  },
  {
    key: "retail_sales",
    title: "Retail Sales",
    seriesId: "RSAFS",
    unit: "Millions USD",
    frequency: "monthly",
    changeMode: "mom_pct"
  }
];

function parseFredValue(raw: string): number | null {
  if (!raw || raw === ".") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function changeFromMode(mode: ChangeMode, values: number[]): number | null {
  if (values.length < 2) return null;

  const latest = values[0];
  const previous = values[1];

  if (mode === "delta_pp") return latest - previous;
  if (mode === "delta_abs") return latest - previous;

  if (mode === "mom_pct" || mode === "qoq_pct") {
    if (previous === 0) return null;
    return ((latest - previous) / previous) * 100;
  }

  if (mode === "yoy_pct") {
    if (values.length < 13) return null;
    const baseline = values[12];
    if (baseline === 0) return null;
    return ((latest - baseline) / baseline) * 100;
  }

  return null;
}

async function fetchIndicator(definition: MacroIndicatorDefinition, apiKey: string): Promise<MacroIndicatorSnapshot> {
  const url = new URL(FRED_BASE_URL);
  url.searchParams.set("series_id", definition.seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", definition.changeMode === "yoy_pct" ? "30" : "8");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) {
      throw new Error(`FRED request failed (${response.status})`);
    }

    const payload = (await response.json()) as FredObservationResponse;
    const observations = Array.isArray(payload.observations) ? payload.observations : [];
    const parsed = observations
      .map((row) => ({
        date: typeof row.date === "string" ? row.date : null,
        value: parseFredValue(typeof row.value === "string" ? row.value : "")
      }))
      .filter((row): row is { date: string; value: number } => row.date !== null && row.value !== null);

    const values = parsed.map((row) => row.value);
    const latest = parsed[0] ?? null;
    const change = changeFromMode(definition.changeMode, values);

    return {
      key: definition.key,
      title: definition.title,
      seriesId: definition.seriesId,
      unit: definition.unit,
      frequency: definition.frequency,
      value: latest?.value ?? null,
      date: latest?.date ?? null,
      change,
      changeMode: definition.changeMode
    };
  } catch {
    return {
      key: definition.key,
      title: definition.title,
      seriesId: definition.seriesId,
      unit: definition.unit,
      frequency: definition.frequency,
      value: null,
      date: null,
      change: null,
      changeMode: definition.changeMode
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildFredMacroPayload(): Promise<MacroFredPayload> {
  const key = (process.env.FRED_API_KEY ?? "").trim();
  if (!key) {
    throw new Error("FRED_API_KEY is not configured.");
  }

  const [indicators, macroRegime] = await Promise.all([
    Promise.all(INDICATORS.map((definition) => fetchIndicator(definition, key))),
    getDashboardMacroRegime(null).catch(() => null)
  ]);

  return {
    indicators,
    fetchedAt: new Date().toISOString(),
    macroRegime
  };
}

