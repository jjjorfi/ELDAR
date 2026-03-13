"use client";

import clsx from "clsx";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  BookText,
  BriefcaseBusiness,
  Grid2x2,
  LayoutDashboard,
  LineChart,
  Mail,
  Moon,
  Sun
} from "lucide-react";

const ELDAR_BRAND_LOGO = "/brand/eldar-logo.png";

export type SidebarView = "dashboard" | "sectors" | "macro" | "journal" | "portfolio";
export type ThemeMode = "dark" | "light";

interface AppLeftSidebarProps {
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
}

function XBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.039 9.19L24 22.847h-7.406l-5.8-7.584-6.64 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zM17.61 20.644h2.039L6.486 3.24H4.298z" />
    </svg>
  );
}

function TelegramBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.62 8.17-1.95 9.19c-.15.65-.54.81-1.09.5l-3.02-2.23-1.46 1.41c-.16.16-.3.3-.62.3l.22-3.11 5.66-5.11c.25-.22-.05-.34-.38-.12l-7 4.41-3.02-.94c-.66-.2-.67-.66.14-.97l11.79-4.55c.55-.2 1.03.13.85.93z" />
    </svg>
  );
}

function SubstackBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M3 4h18v3H3z" fill="currentColor" opacity="0.96" />
      <path d="M3 9h18v2H3z" fill="currentColor" opacity="0.82" />
      <path d="M3 13h18v2H3z" fill="currentColor" opacity="0.74" />
      <path d="M3 17h18v3l-9-3-9 3z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

function SidebarIconButton({
  label,
  active,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={clsx(
        "eldar-nav-icon flex h-11 w-11 items-center justify-center transition-colors",
        active ? "text-white" : "text-white/72 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

export function AppLeftSidebar({
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
  onToggleTheme
}: AppLeftSidebarProps): JSX.Element {
  void loading;
  void defaultSearchValue;
  void onQuickSearch;

  return (
    <aside
      className={clsx(
        "eldar-sidebar-liquid fixed bottom-0 left-0 top-0 z-50 w-[84px]",
        "pointer-events-auto"
      )}
    >
      <div className="flex h-full flex-col items-center justify-between px-1 pb-4 pt-6">
        <div className="flex w-full flex-col items-center gap-3">
          <button type="button" className="eldar-logo-button flex cursor-pointer items-center justify-center" onClick={onOpenDashboard}>
            <div className="eldar-logo-mark relative h-[60px] w-[60px] overflow-hidden">
              <Image src={ELDAR_BRAND_LOGO} alt="ELDAR logo" fill sizes="60px" className="object-contain" priority />
            </div>
          </button>

          <div className="flex flex-col items-center gap-2 pb-1">
            <SidebarIconButton label="Dashboard" active={activeView === "dashboard"} onClick={onOpenDashboard}>
              <LayoutDashboard className="h-4 w-4" />
            </SidebarIconButton>
            <SidebarIconButton label="Sectors" active={activeView === "sectors"} onClick={onOpenSectors}>
              <Grid2x2 className="h-4 w-4" />
            </SidebarIconButton>
            <SidebarIconButton label="Macro" active={activeView === "macro"} onClick={onOpenMacro}>
              <LineChart className="h-4 w-4" />
            </SidebarIconButton>
            <SidebarIconButton label="Journal" active={activeView === "journal"} onClick={onOpenJournal}>
              <BookText className="h-4 w-4" />
            </SidebarIconButton>
            <SidebarIconButton label="Portfolio" active={activeView === "portfolio"} onClick={onOpenPortfolio}>
              <BriefcaseBusiness className="h-4 w-4" />
            </SidebarIconButton>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="Toggle theme"
          >
            {themeMode === "dark" ? <Sun className="eldar-theme-glyph h-3.5 w-3.5" /> : <Moon className="eldar-theme-glyph h-3.5 w-3.5" />}
          </button>
          <a
            href="https://x.com/ELDAR_AI?s=20"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="X"
          >
            <XBrandIcon />
          </a>
          <a
            href="https://t.me"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="Telegram"
          >
            <TelegramBrandIcon />
          </a>
          <a
            href="https://eldarfrequency.substack.com"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="Substack"
          >
            <SubstackBrandIcon />
          </a>
          <a
            href="https://eldar.beehiiv.com"
            target="_blank"
            rel="noreferrer"
            className="eldar-menu-icon p-1.5 text-white/75 transition hover:text-white"
            aria-label="Newsletter"
          >
            <Mail className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </aside>
  );
}
