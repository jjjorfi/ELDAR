"use client";

import { AppLeftSidebar, type SidebarView, type ThemeMode } from "@/components/AppLeftSidebar";

type ViewMode = "home" | "results" | "watchlist" | "portfolio";

interface NavigationSidebarProps {
  view: ViewMode;
  themeMode: ThemeMode;
  loading: boolean;
  marketOpen: boolean;
  profileOpen: boolean;
  menuContext: "home" | "sectors";
  headerVisible: boolean;
  showFadeTransition: boolean;
  defaultSearchValue: string;
  onToggleTheme: () => void;
  onHome: () => void;
  onOpenSectors: () => void;
  onOpenMacro: () => void;
  onOpenJournal: () => void;
  onPortfolio: () => void;
  onQuickSearch: (value: string) => void;
  logoSrc?: string;
}

function toSidebarView(view: ViewMode): SidebarView {
  if (view === "portfolio") return "portfolio";
  if (view === "watchlist") return "dashboard";
  if (view === "results") return "dashboard";
  return "dashboard";
}

/**
 * Keeps the stock dashboard on the same icon-rail sidebar shell as the rest of
 * the app. The additional navigation props exist for compatibility with the
 * dashboard controller and intentionally do not change the visual chrome.
 */
export function NavigationSidebar({
  view,
  themeMode,
  loading,
  marketOpen,
  profileOpen,
  menuContext,
  headerVisible,
  showFadeTransition,
  defaultSearchValue,
  onToggleTheme,
  onHome,
  onOpenSectors,
  onOpenMacro,
  onOpenJournal,
  onPortfolio,
  onQuickSearch
}: NavigationSidebarProps): JSX.Element {
  void marketOpen;
  void profileOpen;
  void menuContext;
  void headerVisible;
  void showFadeTransition;

  return (
    <AppLeftSidebar
      activeView={toSidebarView(view)}
      themeMode={themeMode}
      loading={loading}
      defaultSearchValue={defaultSearchValue}
      onQuickSearch={onQuickSearch}
      onOpenDashboard={onHome}
      onOpenSectors={onOpenSectors}
      onOpenMacro={onOpenMacro}
      onOpenJournal={onOpenJournal}
      onOpenPortfolio={onPortfolio}
      onToggleTheme={onToggleTheme}
    />
  );
}
