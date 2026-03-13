"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

type SidebarContextType = {
  collapsed: boolean;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  toggle: () => undefined
});

const STORAGE_KEY = "eldar_sidebar";
const EXPANDED_OFFSET = "248px";
const COLLAPSED_OFFSET = "72px";
const DEFAULT_OFFSET = "104px";

export const useSidebar = () => useContext(SidebarContext);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "1") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--eldar-sidebar-offset", collapsed ? COLLAPSED_OFFSET : EXPANDED_OFFSET);
    return () => {
      document.documentElement.style.setProperty("--eldar-sidebar-offset", DEFAULT_OFFSET);
    };
  }, [collapsed]);

  const toggle = () => {
    setCollapsed((value) => {
      const next = !value;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return <SidebarContext.Provider value={{ collapsed, toggle }}>{children}</SidebarContext.Provider>;
}

type SidebarProps = {
  children: ReactNode;
  className?: string;
};

export function Sidebar({ children, className }: SidebarProps) {
  const { collapsed } = useSidebar();

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col overflow-hidden border-r border-white/6 bg-zinc-950",
        "transition-[width] duration-300 ease-in-out",
        collapsed ? "w-14" : "w-56",
        className
      )}
    >
      {children}
    </aside>
  );
}

export function SidebarToggle({ className }: { className?: string }) {
  const { collapsed, toggle } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-zinc-900",
        "text-zinc-500 transition-colors duration-200 hover:text-zinc-300",
        className
      )}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
    </button>
  );
}

type NavItemProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
};

export function NavItem({ icon, label, active, onClick, badge }: NavItemProps) {
  const { collapsed } = useSidebar();

  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        "transition-colors duration-150",
        active ? "bg-white/8 text-zinc-100" : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300"
      )}
    >
      <span className={cn("shrink-0 transition-colors", active ? "text-zinc-200" : "text-zinc-600 group-hover:text-zinc-400")}>
        {icon}
      </span>
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-sm font-medium transition-all duration-300",
          collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
        )}
      >
        {label}
      </span>
      {badge !== undefined && badge > 0 ? (
        <span
          className={cn(
            "ml-auto flex h-[1.1rem] min-w-[1.1rem] shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-medium text-violet-400",
            "transition-all duration-300",
            collapsed && "absolute right-1.5 top-1.5 scale-75"
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

export function SidebarSection({ label }: { label: string }) {
  const { collapsed } = useSidebar();

  return (
    <div
      className={cn(
        "overflow-hidden px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-widest text-zinc-700 transition-all duration-300",
        collapsed ? "h-0 pb-0 pt-0 opacity-0" : "h-auto opacity-100"
      )}
    >
      {label}
    </div>
  );
}
