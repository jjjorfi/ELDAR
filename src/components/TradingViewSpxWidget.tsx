"use client";

import { useState } from "react";
import { useEffect, useRef } from "react";

interface TradingViewSpxWidgetProps {
  height?: number;
  src: string;
  title: string;
  loadingLabel?: string;
}

export function TradingViewSpxWidget({
  height = 420,
  src,
  title,
  loadingLabel = "Loading Market Chart"
}: TradingViewSpxWidgetProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const revealTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-xl" style={{ height }}>
      {!revealed ? (
        <div className="absolute inset-0 flex items-center justify-center border border-white/10 bg-[#111317]">
          <div className="text-center">
            <div className="mx-auto mb-3 h-9 w-9 animate-pulse rounded-full border border-zinc-400/40 bg-zinc-300/10" />
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">{loadingLabel}</p>
          </div>
        </div>
      ) : null}

      <iframe
        src={src}
        width="100%"
        height={height}
        frameBorder="0"
        title={title}
        loading="lazy"
        onLoad={() => {
          setLoaded(true);
          if (revealTimerRef.current !== null) {
            window.clearTimeout(revealTimerRef.current);
          }
          revealTimerRef.current = window.setTimeout(() => {
            setRevealed(true);
          }, 700);
        }}
        className={`w-full rounded-xl transition-opacity duration-300 ${loaded && revealed ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
