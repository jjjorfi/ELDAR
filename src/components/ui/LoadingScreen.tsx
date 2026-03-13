"use client";

import { useEffect, useState } from "react";

type LoadingScreenProps = {
  name?: string;
  duration?: number;
  alwaysShow?: boolean;
};

const STORAGE_KEY = "eldar_loaded";

export function LoadingScreen({
  name = "ELDAR",
  duration = 1800,
  alwaysShow = false
}: LoadingScreenProps) {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    const seen = sessionStorage.getItem(STORAGE_KEY);
    if (seen && !alwaysShow) return;

    setVisible(true);
    sessionStorage.setItem(STORAGE_KEY, "1");

    const holdTimer = setTimeout(() => setPhase("hold"), 400);
    const outTimer = setTimeout(() => setPhase("out"), duration - 300);
    const hideTimer = setTimeout(() => setVisible(false), duration);

    return () => {
      clearTimeout(holdTimer);
      clearTimeout(outTimer);
      clearTimeout(hideTimer);
    };
  }, [duration, alwaysShow]);

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes loader-bar {
          0%   { width: 0%; opacity: 1; }
          80%  { width: 85%; opacity: 1; }
          100% { width: 100%; opacity: 0; }
        }
        @keyframes loader-char {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes loader-fade-out {
          0%   { opacity: 1; }
          100% { opacity: 0; pointer-events: none; }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99999,
          background: "#09090b",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "2rem",
          animation: phase === "out" ? "loader-fade-out 0.35s ease forwards" : undefined
        }}
      >
        <div style={{ display: "flex", gap: "0.05em" }}>
          {name.split("").map((char, index) => (
            <span
              key={`${char}-${index}`}
              style={{
                fontSize: "clamp(2rem, 6vw, 3.5rem)",
                fontWeight: 600,
                letterSpacing: "0.2em",
                color: "#fff",
                fontFamily: "inherit",
                opacity: 0,
                animation: "loader-char 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
                animationDelay: `${index * 60}ms`
              }}
            >
              {char}
            </span>
          ))}
        </div>

        <div
          style={{
            width: "120px",
            height: "1px",
            background: "rgba(255,255,255,0.08)",
            borderRadius: "1px",
            overflow: "hidden",
            position: "relative"
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              background: "linear-gradient(90deg, #6366f1, #a78bfa)",
              animation: `loader-bar ${duration - 400}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`,
              animationDelay: "200ms",
              borderRadius: "1px"
            }}
          />
        </div>

        <p
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.25em",
            color: "rgba(255,255,255,0.2)",
            textTransform: "uppercase",
            fontFamily: "inherit"
          }}
        >
          Initializing
        </p>
      </div>
    </>
  );
}
