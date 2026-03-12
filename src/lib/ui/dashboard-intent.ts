// Shared sessionStorage helpers for returning users to the dashboard in a
// specific state. Standalone pages and the global command palette both write
// this payload before routing home. Gotcha: this intentionally writes only UI
// intent, not sensitive account data.

export const DASHBOARD_RETURN_STATE_KEY = "eldar:dashboard:return-state";

export type DashboardIntentView = "home" | "portfolio" | "watchlist";
export type DashboardPaletteAction = "analyze" | "portfolio-add" | "compare-add" | "watchlist-add";

interface DashboardIntentOptions {
  openPalette?: boolean;
  paletteAction?: DashboardPaletteAction;
  autoAnalyze?: boolean;
}

export function stashDashboardIntent(
  view: DashboardIntentView,
  ticker = "",
  options?: DashboardIntentOptions
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      DASHBOARD_RETURN_STATE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        isAppOpen: true,
        view,
        ticker: ticker.trim().toUpperCase(),
        openPalette: Boolean(options?.openPalette),
        paletteAction: options?.paletteAction ?? "analyze",
        autoAnalyze: Boolean(options?.autoAnalyze)
      })
    );
  } catch {
    // Intent persistence is an enhancement, not critical path.
  }
}
