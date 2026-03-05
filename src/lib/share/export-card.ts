import { toPng } from "html-to-image";
import type { RefObject } from "react";

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

  const link = document.createElement("a");
  link.download = `${filename}-eldar.png`;
  link.href = dataUrl;
  link.click();
}
