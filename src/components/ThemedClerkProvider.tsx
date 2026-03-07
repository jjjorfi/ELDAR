"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";

type ThemeMode = "dark" | "light";

function resolveThemeMode(): ThemeMode {
  if (typeof document !== "undefined") {
    const fromDataset = document.documentElement.dataset.theme;
    if (fromDataset === "light" || fromDataset === "dark") {
      return fromDataset;
    }
  }

  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem("eldar-theme-mode");
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  }

  return "dark";
}

export function ThemedClerkProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    const syncTheme = (): void => {
      setThemeMode(resolveThemeMode());
    };

    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    window.addEventListener("storage", syncTheme);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  const appearance = useMemo(() => {
    const isDark = themeMode === "dark";
    return {
      variables: {
        colorPrimary: "#FFBF00",
        colorBackground: isDark ? "#0F0F0F" : "#FFFFFF",
        colorInputBackground: isDark ? "#1A1A1A" : "#F8FAFC",
        colorInputText: isDark ? "#F5F5F5" : "#0F172A",
        colorText: isDark ? "#F5F5F5" : "#0F172A",
        colorTextSecondary: isDark ? "#999999" : "#475569",
        colorDanger: "#EF4444",
        borderRadius: "0px",
        fontFamily: "Neue Haas Grotesk, Helvetica Neue, Arial, sans-serif"
      },
      elements: {
        card: {
          border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.16)",
          boxShadow: "0 12px 30px rgba(0,0,0,0.35)"
        },
        socialButtonsBlockButton: {
          borderRadius: "0px"
        },
        formButtonPrimary: {
          borderRadius: "0px"
        },
        formFieldInput: {
          borderRadius: "0px"
        },
        footerActionLink: {
          color: "#FFBF00"
        }
      }
    };
  }, [themeMode]);

  return <ClerkProvider appearance={appearance}>{children}</ClerkProvider>;
}
