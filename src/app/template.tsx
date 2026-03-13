"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export default function Template({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const animation = element.animate(
      [
        { opacity: 0, filter: "blur(4px)", transform: "translateY(6px)" },
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" }
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        fill: "forwards"
      }
    );

    return () => {
      animation.cancel();
    };
  }, []);

  return (
    <div ref={ref} style={{ opacity: 0 }}>
      {children}
    </div>
  );
}
