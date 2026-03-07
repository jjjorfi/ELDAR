/* eslint-disable @next/next/no-img-element */

import { scoreCircle, getRatingColor } from "@/components/share-cards/utils";
import type { SignalCardProps } from "@/components/share-cards/types";
import { ratingDisplayLabel } from "@/lib/rating";

export function SignalCard({
  ticker,
  companyName,
  sector,
  score,
  rating,
  confidence,
  drivers,
  risks,
  sectorRank,
  scoreChange
}: SignalCardProps): JSX.Element {
  const ratingColor = getRatingColor(rating);
  const ratingLabel = ratingDisplayLabel(rating);

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        background: "#000",
        border: "1px solid #1E1E1E",
        padding: "64px 72px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 36,
        fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace"
      }}
    >
      <div style={{ textAlign: "center", width: "100%" }}>
        <img
          src="/brand/eldar-logo.png"
          alt="ELDAR"
          style={{ width: 92, height: 92, objectFit: "contain", margin: "0 auto 22px" }}
        />
        <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "#FFBF00", marginBottom: 10 }}>ELDAR SIGNAL</div>
        <div
          style={{
            fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
            fontSize: 44,
            fontWeight: 800,
            color: "#F5F5F5",
            letterSpacing: "-0.02em"
          }}
        >
          {companyName}
        </div>
        <div style={{ fontSize: 13, color: "#666", marginTop: 8, letterSpacing: "0.12em" }}>
          ${ticker} · {sector.toUpperCase()}
        </div>
      </div>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        {scoreCircle(score, rating, 240)}
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
              fontSize: 62,
              fontWeight: 800,
              color: ratingColor,
              lineHeight: 1,
              marginBottom: 12,
              letterSpacing: "-0.02em"
            }}
          >
            {ratingLabel}
          </div>
          <div style={{ fontSize: 16, color: "#7a7a7a", letterSpacing: "0.12em" }}>{confidence} CONFIDENCE</div>
          {scoreChange != null ? (
            <div style={{ marginTop: 8, fontSize: 13, color: scoreChange > 0 ? "#10B981" : "#EF4444" }}>
              {scoreChange > 0 ? "▲" : "▼"} {Math.abs(scoreChange).toFixed(1)} THIS QUARTER
            </div>
          ) : null}
          {sectorRank != null ? (
            <div style={{ marginTop: 8, fontSize: 13, color: "#8c8c8c" }}>TOP {sectorRank}% OF SECTOR</div>
          ) : null}
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 760, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #1E1E1E", background: "#0A0A0A", padding: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#FFBF00", marginBottom: 12 }}>KEY DRIVERS</div>
          {drivers.slice(0, 4).map((item, index) => (
            <div key={`${item}-${index}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <span style={{ color: "#10B981" }}>▲</span>
              <span style={{ fontSize: 12, color: "#9a9a9a", lineHeight: 1.5 }}>{item}</span>
            </div>
          ))}
        </div>
        <div style={{ border: "1px solid #1E1E1E", background: "#0A0A0A", padding: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#666", marginBottom: 12 }}>KEY RISKS</div>
          {risks.slice(0, 4).map((item, index) => (
            <div key={`${item}-${index}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <span style={{ color: "#EF4444" }}>▼</span>
              <span style={{ fontSize: 12, color: "#8a8a8a", lineHeight: 1.5 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "#2A2A2A", letterSpacing: "0.14em" }}>ELDAR · Think like an analyst.</div>
        <div style={{ fontSize: 10, color: "#2A2A2A", letterSpacing: "0.10em" }}>
          {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
        </div>
      </div>
    </div>
  );
}
