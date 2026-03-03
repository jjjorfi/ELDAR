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
    <div className="relative w-full overflow-hidden border border-white/15" style={{ height }}>
      {!revealed ? (
        <div className="absolute inset-0 flex items-center justify-center border border-white/10 bg-[#0F0F0F]">
          <div className="text-center">
            <div className="mx-auto mb-3 h-9 w-9 animate-pulse border border-white/20 bg-[#1A1A1A]" />
            <p className="text-xs uppercase tracking-[0.2em] text-[#999999]">{loadingLabel}</p>
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
        className={`w-full transition-opacity duration-300 ${loaded && revealed ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
