"use client";

import { useCallback } from "react";
import type { WheelEvent } from "react";

const NATIVE_SCROLL_TARGET_SELECTOR = [
  "textarea",
  "input",
  "select",
  "[contenteditable='true']",
  "[data-allow-native-scroll='true']"
].join(",");

export function usePopupWheelScroll<T extends HTMLElement = HTMLDivElement>(): (event: WheelEvent<T>) => void {
  return useCallback((event: WheelEvent<T>) => {
    const container = event.currentTarget;
    const target = event.target as HTMLElement | null;

    if (target?.closest(NATIVE_SCROLL_TARGET_SELECTOR)) {
      return;
    }

    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (maxScrollTop <= 0 || event.deltaY === 0) {
      return;
    }

    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, container.scrollTop + event.deltaY));
    if (nextScrollTop === container.scrollTop) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    container.scrollTop = nextScrollTop;
    event.preventDefault();
    event.stopPropagation();
  }, []);
}
