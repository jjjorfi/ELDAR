// Shared standalone-page shell used by sectors, macro, and journal. It keeps
// the left sidebar, background, content width, and top spacing identical across
// pages so UI changes remain uniform. Keep this shell visual-only.

"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

import { AppLeftSidebar, type SidebarView, type ThemeMode } from "@/components/AppLeftSidebar";

interface AppPageShellProps {
  activeView: SidebarView;
  themeMode: ThemeMode;
  loading?: boolean;
  defaultSearchValue?: string;
  onQuickSearch: (value: string) => void;
  onOpenDashboard: () => void;
  onOpenSectors: () => void;
  onOpenMacro: () => void;
  onOpenJournal: () => void;
  onOpenPortfolio: () => void;
  onToggleTheme: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
  contentClassName?: string;
  background?: string;
}

export function AppPageShell({
  activeView,
  themeMode,
  loading = false,
  defaultSearchValue = "",
  onQuickSearch,
  onOpenDashboard,
  onOpenSectors,
  onOpenMacro,
  onOpenJournal,
  onOpenPortfolio,
  onToggleTheme,
  children,
  maxWidthClassName = "eldar-page-width-lg",
  contentClassName,
  background
}: AppPageShellProps): JSX.Element {
  return (
    <main className="min-h-screen overflow-x-hidden text-white" style={{ background: background ?? "var(--eldar-bg-primary)" }}>
      <AppLeftSidebar
        activeView={activeView}
        themeMode={themeMode}
        loading={loading}
        defaultSearchValue={defaultSearchValue}
        onQuickSearch={onQuickSearch}
        onOpenDashboard={onOpenDashboard}
        onOpenSectors={onOpenSectors}
        onOpenMacro={onOpenMacro}
        onOpenJournal={onOpenJournal}
        onOpenPortfolio={onOpenPortfolio}
        onToggleTheme={onToggleTheme}
      />
      <div className={clsx("eldar-main-layout pb-20", contentClassName)}>
        <div className={clsx("mx-auto w-full", maxWidthClassName)}>{children}</div>
      </div>
    </main>
  );
}
