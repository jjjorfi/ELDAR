import clsx from "clsx";
import Image from "next/image";
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

import {
  NavItem,
  Sidebar,
  SidebarProvider,
  SidebarSection,
  SidebarToggle,
  useSidebar
} from "@/components/ui/Sidebar";

type ViewMode = "home" | "results" | "watchlist" | "portfolio";
type ThemeMode = "dark" | "light";

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

interface EldarLogoProps {
  onClick: () => void;
  logoSrc: string;
}

const DEFAULT_LOGO_SRC = "/brand/eldar-logo.png";

function EldarLogo({ onClick, logoSrc }: EldarLogoProps): JSX.Element {
  return (
    <button type="button" className="eldar-logo-button flex cursor-pointer items-center gap-3" onClick={onClick}>
      <div className="relative h-[60px] w-[60px] overflow-hidden">
        <Image src={logoSrc} alt="ELDAR logo" fill sizes="60px" className="object-contain" priority />
      </div>
    </button>
  );
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
  onQuickSearch,
  logoSrc = DEFAULT_LOGO_SRC
}: NavigationSidebarProps): JSX.Element {
  return (
    <SidebarProvider>
      <NavigationSidebarInner
        view={view}
        themeMode={themeMode}
        loading={loading}
        marketOpen={marketOpen}
        profileOpen={profileOpen}
        menuContext={menuContext}
        headerVisible={headerVisible}
        showFadeTransition={showFadeTransition}
        defaultSearchValue={defaultSearchValue}
        onToggleTheme={onToggleTheme}
        onHome={onHome}
        onOpenSectors={onOpenSectors}
        onOpenMacro={onOpenMacro}
        onOpenJournal={onOpenJournal}
        onPortfolio={onPortfolio}
        onQuickSearch={onQuickSearch}
        logoSrc={logoSrc}
      />
    </SidebarProvider>
  );
}

function NavigationSidebarInner({
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
  onQuickSearch,
  logoSrc = DEFAULT_LOGO_SRC
}: NavigationSidebarProps): JSX.Element {
  void loading;
  void marketOpen;
  void profileOpen;
  void menuContext;
  void defaultSearchValue;
  void onQuickSearch;
  void headerVisible;
  void showFadeTransition;
  const { collapsed } = useSidebar();

  return (
    <Sidebar
      className={clsx(
        "eldar-sidebar-liquid fixed bottom-0 left-0 top-0 z-50 transition-all duration-[220ms] ease-out",
        "pointer-events-auto translate-y-0 opacity-100"
      )}
    >
      <SidebarToggle />
      <div className={clsx("flex h-full flex-col justify-between pb-4 pt-6", collapsed ? "px-1" : "px-3")}>
        <div className="flex w-full flex-col gap-3">
          <div className={clsx("flex w-full", collapsed ? "justify-center" : "justify-start px-1")}>
            <EldarLogo onClick={onHome} logoSrc={logoSrc} />
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            <SidebarSection label="Overview" />
            <NavItem
              icon={<LayoutDashboard className="h-4 w-4" />}
              label="Dashboard"
              active={view === "home"}
              onClick={onHome}
            />
            <NavItem
              icon={<BriefcaseBusiness className="h-4 w-4" />}
              label="Portfolio"
              active={view === "portfolio"}
              onClick={onPortfolio}
            />
            <SidebarSection label="Research" />
            <NavItem
              icon={<Grid2x2 className="h-4 w-4" />}
              label="Sectors"
              onClick={onOpenSectors}
            />
            <NavItem
              icon={<LineChart className="h-4 w-4" />}
              label="Macro"
              onClick={onOpenMacro}
            />
            <NavItem
              icon={<BookText className="h-4 w-4" />}
              label="Journal"
              onClick={onOpenJournal}
            />
          </nav>
        </div>

        <div className="flex flex-col gap-2">
          <SidebarSection label="Connect" />
          <div className={clsx("flex gap-2", collapsed ? "flex-col items-center" : "items-center justify-between px-1")}>
            <button
              type="button"
              onClick={onToggleTheme}
              className={clsx(
                "eldar-menu-icon p-1.5 text-white/75 transition hover:text-white",
                themeMode === "dark" ? "text-white" : "bg-transparent text-white/85"
              )}
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
      </div>
    </Sidebar>
  );
}
