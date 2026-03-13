"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MarketStateChange = number | null;

type LiveTitleOptions = {
  appName?: string;
  symbol?: string;
  price?: number;
  prefix?: string;
};

type Shortcut = {
  keys: string[];
  description: string;
  group?: string;
};

type KeyboardShortcutsProps = {
  shortcuts?: Shortcut[];
};

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { group: "Navigation", keys: ["⌘", "K"], description: "Command palette" },
  { group: "Navigation", keys: ["/"], description: "Focus search" },
  { group: "Navigation", keys: ["S"], description: "Search stocks" },
  { group: "Navigation", keys: ["P"], description: "Go to Portfolio" },
  { group: "Navigation", keys: ["J"], description: "Open Journal" },
  { group: "Help", keys: ["?"], description: "This cheat sheet" },
  { group: "Help", keys: ["Esc"], description: "Close / dismiss" }
];

export function useDynamicFavicon(changePercent: MarketStateChange) {
  useEffect(() => {
    const color =
      changePercent === null ? "#6b7280" :
      changePercent > 0 ? "#10b981" :
      changePercent < 0 ? "#ef4444" :
      "#6b7280";

    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#09090b";
    ctx.fill();

    const dotSize = changePercent === null ? 6 : 8;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, dotSize, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, dotSize - 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    const dataUrl = canvas.toDataURL("image/png");

    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = dataUrl;
  }, [changePercent]);
}

export function useLiveTitle({
  appName = "ELDAR",
  symbol,
  price,
  prefix
}: LiveTitleOptions) {
  useEffect(() => {
    const parts: string[] = [];

    if (prefix) {
      parts.push(prefix);
    } else if (symbol && price !== undefined) {
      parts.push(
        `${symbol} $${price.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`
      );
    }

    parts.push(appName);
    document.title = parts.join(" · ");
  }, [appName, symbol, price, prefix]);
}

export function KeyboardShortcuts({ shortcuts = DEFAULT_SHORTCUTS }: KeyboardShortcutsProps) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "?" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggle();
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  const groups = useMemo(
    () =>
      shortcuts.reduce<Record<string, Shortcut[]>>((accumulator, shortcut) => {
        const group = shortcut.group ?? "General";
        if (!accumulator[group]) accumulator[group] = [];
        accumulator[group].push(shortcut);
        return accumulator;
      }, {}),
    [shortcuts]
  );

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)"
      }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          background: "#111113",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "1rem",
          padding: "1.5rem",
          minWidth: "480px",
          maxWidth: "560px",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 25px 60px rgba(0,0,0,0.6)"
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <h2 style={{ color: "#fff", fontSize: "0.875rem", fontWeight: 600, margin: 0 }}>
            Keyboard shortcuts
          </h2>
          <kbd
            style={{
              fontSize: "0.65rem",
              color: "#6b7280",
              background: "rgba(255,255,255,0.06)",
              padding: "2px 6px",
              borderRadius: "4px"
            }}
          >
            ?
          </kbd>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p
                style={{
                  fontSize: "0.65rem",
                  color: "#4b5563",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: "0.6rem"
                }}
              >
                {group}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {items.map((shortcut, index) => (
                  <div key={`${group}-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                    <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>{shortcut.description}</span>
                    <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                      {shortcut.keys.map((key, keyIndex) => (
                        <kbd
                          key={`${group}-${index}-${keyIndex}`}
                          style={{
                            fontSize: "0.65rem",
                            color: "#d1d5db",
                            background: "rgba(255,255,255,0.07)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: "4px",
                            padding: "2px 6px",
                            fontFamily: "monospace"
                          }}
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
