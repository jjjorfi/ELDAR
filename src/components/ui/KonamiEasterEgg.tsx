"use client";

import { useCallback, useEffect, useState } from "react";

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a"
] as const;

export function useKonamiCode(onActivate: () => void) {
  const [sequence, setSequence] = useState<string[]>([]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      setSequence((prev) => {
        const next = [...prev, event.key].slice(-KONAMI.length);
        if (next.join(",") === KONAMI.join(",")) {
          onActivate();
          return [];
        }
        return next;
      });
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onActivate]);
}

export function KonamiEasterEgg() {
  const [active, setActive] = useState(false);

  const activate = useCallback(() => setActive(true), []);
  useKonamiCode(activate);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), 4000);
    return () => clearTimeout(timer);
  }, [active]);

  if (!active) return null;

  return (
    <>
      <style>{`
        @keyframes konami-in {
          0%   { opacity: 0; transform: scale(0.8) translateY(20px); }
          60%  { transform: scale(1.04) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes konami-out {
          0%   { opacity: 1; }
          100% { opacity: 0; transform: scale(0.9); }
        }
        @keyframes ticker-tape {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          bottom: "2rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 99999,
          animation: "konami-in 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards"
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #1e1b4b, #312e81)",
            border: "1px solid rgba(139,92,246,0.4)",
            borderRadius: "1rem",
            padding: "1rem 1.5rem",
            boxShadow: "0 0 40px rgba(139,92,246,0.3)",
            textAlign: "center",
            minWidth: "280px"
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎰</div>
          <p style={{ color: "#c4b5fd", fontWeight: 600, fontSize: "0.875rem", margin: 0 }}>
            +∞ Alpha Unlocked
          </p>
          <p style={{ color: "rgba(196,181,253,0.5)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
            You found it. Respect.
          </p>
        </div>
      </div>
    </>
  );
}
