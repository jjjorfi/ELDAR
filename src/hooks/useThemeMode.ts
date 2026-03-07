// AI CONTEXT TRACE
// Small shared hook for persisting the app theme mode. Standalone pages use it
// so theme behavior stays uniform without duplicating localStorage/document
// wiring in each page component.

"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export type AppThemeMode = "dark" | "light";

export function useThemeMode(): [AppThemeMode, Dispatch<SetStateAction<AppThemeMode>>, string] {
  const [themeMode, setThemeMode] = useState<AppThemeMode>("dark");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("eldar-theme-mode");
      const mode = saved === "light" ? "light" : "dark";
      setThemeMode(mode);
      document.documentElement.dataset.theme = mode;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem("eldar-theme-mode", themeMode);
    } catch {
      // Theme persistence is optional.
    }
  }, [themeMode]);

  return [themeMode, setThemeMode, themeMode === "dark" ? "#000000" : "#e9e5dc"];
}
