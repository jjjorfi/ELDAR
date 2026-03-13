import type { HomeDashboardPayload, HomeRegimeMetric } from "@/lib/home/dashboard-types";

function isUsableMetric(metric: HomeRegimeMetric | null | undefined): boolean {
  if (!metric) return false;
  if (metric.value === null || !Number.isFinite(metric.value)) return false;
  if (!metric.displayValue || metric.displayValue === "N/A") return false;
  if (!metric.detail || metric.detail === "Change unavailable") return false;
  return true;
}

export function isUsableDashboardRegime(
  regime: HomeDashboardPayload["regime"] | null | undefined
): regime is HomeDashboardPayload["regime"] {
  if (!regime) return false;
  if (!Array.isArray(regime.metrics) || regime.metrics.length < 4) return false;

  const nominalTenYearMetric = regime.metrics.find((metric) => metric.key === "nominal10Y");
  const vixMetric = regime.metrics.find((metric) => metric.key === "vix");
  const dxyMetric = regime.metrics.find((metric) => metric.key === "dxy");
  const oilMetric = regime.metrics.find((metric) => metric.key === "oilWTI");

  return [nominalTenYearMetric, vixMetric, dxyMetric, oilMetric].every(isUsableMetric);
}

export function isUsableHomeDashboardPayload(
  payload: HomeDashboardPayload | null | undefined
): payload is HomeDashboardPayload {
  if (!payload) return false;
  if (!payload.generatedAt || Number.isNaN(Date.parse(payload.generatedAt))) return false;
  if (!Array.isArray(payload.snapshot) || !Array.isArray(payload.marketMovers)) return false;
  if (!Array.isArray(payload.sectorRotation) || !Array.isArray(payload.marketNews)) return false;
  return isUsableDashboardRegime(payload.regime);
}
