"use client";

const variants = {
  neutral: {
    a: "radial-gradient(ellipse 80% 60% at 20% 40%, #1e293b 0%, transparent 70%)",
    b: "radial-gradient(ellipse 70% 80% at 80% 60%, #0f172a 0%, transparent 70%)",
    c: "radial-gradient(ellipse 60% 70% at 50% 20%, #1e3a5f 0%, transparent 70%)"
  },
  bull: {
    a: "radial-gradient(ellipse 80% 60% at 15% 50%, #064e3b 0%, transparent 70%)",
    b: "radial-gradient(ellipse 70% 80% at 85% 40%, #022c22 0%, transparent 70%)",
    c: "radial-gradient(ellipse 60% 70% at 50% 80%, #065f46 0%, transparent 70%)"
  },
  bear: {
    a: "radial-gradient(ellipse 80% 60% at 20% 50%, #450a0a 0%, transparent 70%)",
    b: "radial-gradient(ellipse 70% 80% at 80% 30%, #3b0505 0%, transparent 70%)",
    c: "radial-gradient(ellipse 60% 70% at 50% 80%, #500a0a 0%, transparent 70%)"
  },
  dark: {
    a: "radial-gradient(ellipse 80% 60% at 20% 40%, #18181b 0%, transparent 70%)",
    b: "radial-gradient(ellipse 70% 80% at 80% 60%, #09090b 0%, transparent 70%)",
    c: "radial-gradient(ellipse 60% 70% at 50% 20%, #27272a 0%, transparent 70%)"
  }
} as const;

type BreathingBackgroundProps = {
  variant?: keyof typeof variants;
  opacity?: number;
};

export function BreathingBackground({
  variant = "dark",
  opacity = 0.12
}: BreathingBackgroundProps): JSX.Element {
  const palette = variants[variant];

  return (
    <>
      <style>{`
        @keyframes breath-a {
          0%, 100% { transform: scale(1) translate(0, 0); }
          33% { transform: scale(1.08) translate(2%, -3%); }
          66% { transform: scale(0.95) translate(-2%, 2%); }
        }

        @keyframes breath-b {
          0%, 100% { transform: scale(1) translate(0, 0); }
          33% { transform: scale(0.94) translate(-3%, 2%); }
          66% { transform: scale(1.06) translate(3%, -2%); }
        }

        @keyframes breath-c {
          0%, 100% { transform: scale(1) translate(0, 0); }
          40% { transform: scale(1.05) translate(1%, 3%); }
          70% { transform: scale(0.97) translate(-1%, -2%); }
        }
      `}</style>

      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: palette.a,
          opacity,
          pointerEvents: "none",
          zIndex: 0,
          animation: "breath-a 18s ease-in-out infinite",
          transition: "background 3s ease"
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: palette.b,
          opacity: opacity * 0.7,
          pointerEvents: "none",
          zIndex: 0,
          animation: "breath-b 24s ease-in-out infinite",
          transition: "background 3s ease"
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: palette.c,
          opacity: opacity * 0.5,
          pointerEvents: "none",
          zIndex: 0,
          animation: "breath-c 14s ease-in-out infinite",
          transition: "background 3s ease"
        }}
      />
    </>
  );
}

type LiveBreathingProps = {
  marketState: "bull" | "bear" | "neutral" | "closed" | "loading";
  opacity?: number;
};

export function LiveBreathingBackground({
  marketState,
  opacity = 0.1
}: LiveBreathingProps): JSX.Element {
  const variantMap: Record<LiveBreathingProps["marketState"], keyof typeof variants> = {
    bull: "bull",
    bear: "bear",
    neutral: "dark",
    closed: "dark",
    loading: "dark"
  };

  return <BreathingBackground variant={variantMap[marketState] ?? "dark"} opacity={opacity} />;
}
