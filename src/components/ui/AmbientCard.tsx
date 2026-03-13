"use client";

import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "@/lib/utils";

type AmbientCardProps = {
  value?: number;
  children: ReactNode;
  className?: string;
  sentiment?: "positive" | "negative" | "neutral";
  intensity?: number;
};

function getSentiment(value?: number, override?: "positive" | "negative" | "neutral") {
  if (override) return override;
  if (value === undefined || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function getIntensity(value?: number, multiplier = 1): number {
  if (!value) return 0;
  const abs = Math.min(Math.abs(value), 20);
  return (abs / 20) * 0.22 * multiplier;
}

export function AmbientCard({
  value,
  children,
  className,
  sentiment: sentimentOverride,
  intensity: intensityMultiplier = 1
}: AmbientCardProps): JSX.Element {
  const sentiment = getSentiment(value, sentimentOverride);
  const alpha = getIntensity(value, intensityMultiplier);

  const glowColor = {
    positive: `rgba(16, 185, 129, ${alpha})`,
    negative: `rgba(239, 68, 68, ${alpha})`,
    neutral: "transparent"
  }[sentiment];

  const borderColor = {
    positive: alpha > 0.05 ? `rgba(16, 185, 129, ${alpha * 1.5})` : "rgba(255,255,255,0.08)",
    negative: alpha > 0.05 ? `rgba(239, 68, 68, ${alpha * 1.5})` : "rgba(255,255,255,0.08)",
    neutral: "rgba(255,255,255,0.08)"
  }[sentiment];

  return (
    <div
      className={cn("relative rounded-2xl transition-all duration-700", className)}
      style={{
        border: `1px solid ${borderColor}`,
        boxShadow:
          sentiment !== "neutral" && alpha > 0.02
            ? `0 0 20px 2px ${glowColor}, inset 0 0 20px 0px ${glowColor}`
            : undefined,
        transition: "box-shadow 1s ease, border-color 1s ease"
      }}
    >
      {children}
    </div>
  );
}

export function PulsingAmbientCard(props: AmbientCardProps): JSX.Element {
  const sentiment = getSentiment(props.value, props.sentiment);
  const alpha = getIntensity(props.value, props.intensity);
  const animationId = useId().replace(/:/g, "");

  const pulseColor = {
    positive: `rgba(16, 185, 129, ${alpha})`,
    negative: `rgba(239, 68, 68, ${alpha})`,
    neutral: "transparent"
  }[sentiment];

  const pulseColorHalf = {
    positive: `rgba(16, 185, 129, ${alpha * 0.4})`,
    negative: `rgba(239, 68, 68, ${alpha * 0.4})`,
    neutral: "transparent"
  }[sentiment];

  const animationName = `pulse-${animationId}-${sentiment}`;

  return (
    <>
      {sentiment !== "neutral" && alpha > 0.02 ? (
        <style>{`
          @keyframes ${animationName} {
            0%, 100% { box-shadow: 0 0 16px 1px ${pulseColorHalf}, inset 0 0 16px 0 ${pulseColorHalf}; }
            50% { box-shadow: 0 0 28px 4px ${pulseColor}, inset 0 0 24px 0 ${pulseColor}; }
          }
        `}</style>
      ) : null}
      <div
        className={cn("relative rounded-2xl", props.className)}
        style={{
          border: `1px solid ${sentiment !== "neutral" ? pulseColor : "rgba(255,255,255,0.08)"}`,
          animation:
            sentiment !== "neutral" && alpha > 0.02
              ? `${animationName} 3s ease-in-out infinite`
              : undefined,
          transition: "border-color 1s ease"
        }}
      >
        {props.children}
      </div>
    </>
  );
}
