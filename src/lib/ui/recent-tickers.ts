const RECENT_TICKERS_KEY = "eldar:recent-tickers";
const MAX_RECENT_TICKERS = 10;

function sanitizeTicker(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

export function getRecentTickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_TICKERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? sanitizeTicker(item) : ""))
      .filter((item) => item.length > 0)
      .slice(0, MAX_RECENT_TICKERS);
  } catch {
    return [];
  }
}

export function pushRecentTicker(symbol: string): string[] {
  const ticker = sanitizeTicker(symbol);
  if (!ticker || typeof window === "undefined") return [];
  const prev = getRecentTickers();
  const next = [ticker, ...prev.filter((entry) => entry !== ticker)].slice(0, MAX_RECENT_TICKERS);
  try {
    window.localStorage.setItem(RECENT_TICKERS_KEY, JSON.stringify(next));
  } catch {
    // no-op
  }
  return next;
}

export { MAX_RECENT_TICKERS, RECENT_TICKERS_KEY };
