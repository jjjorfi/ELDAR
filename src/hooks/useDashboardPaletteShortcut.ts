// AI CONTEXT TRACE
// Shared keyboard shortcut hook that opens the dashboard command palette from
// standalone pages. This keeps `/` and Cmd/Ctrl+K behavior consistent across
// sectors, macro, and journal without duplicating event listeners.

"use client";

import { useEffect } from "react";

import { isPaletteOpenShortcut } from "@/lib/ui/command-palette";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function useDashboardPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isPaletteOpenShortcut(event)) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        onOpen();
        return;
      }

      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      onOpen();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}
