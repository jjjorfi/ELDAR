import { toPng } from "html-to-image";
import type { RefObject } from "react";

export function buildShareFilename(filename: string): string {
  const cleaned = filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${cleaned || "share"}-eldar.png`;
}

export async function exportCard(
  elementRef: RefObject<HTMLDivElement>,
  filename: string
): Promise<void> {
  if (!elementRef.current) return;

  const dataUrl = await toPng(elementRef.current, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#000"
  });

  const shareFilename = buildShareFilename(filename);

  if (typeof window !== "undefined" && "ClipboardItem" in window && navigator.clipboard?.write) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const item = new window.ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
    } catch {
      // Clipboard write can fail due to browser permissions; fallback download still runs.
    }
  }

  const link = document.createElement("a");
  link.download = shareFilename;
  link.href = dataUrl;
  link.click();
}
