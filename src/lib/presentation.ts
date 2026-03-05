export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export function getConfidence(dataCompleteness: number, monthsOfHistory: number): Confidence {
  if (dataCompleteness >= 0.9 && monthsOfHistory >= 36) return "HIGH";
  if (dataCompleteness >= 0.7 && monthsOfHistory >= 12) return "MEDIUM";
  return "LOW";
}

export function formatAsOfDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "N/A";
  return new Date(parsed).toLocaleString();
}

export function formatAsOfDateOnly(value: string | null | undefined): string {
  if (!value) return "N/A";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "N/A";
  return new Date(parsed).toLocaleDateString();
}

export function isStale(value: string | null | undefined, staleHours = 24): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > staleHours * 60 * 60 * 1000;
}
