import { scoreCircle, getRatingColor } from "@/components/share-cards/utils";
import type { SignalCardProps } from "@/components/share-cards/types";

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
  const ratingLabel = rating.replace("_", " ");

  return (
    <div
      style={{
        width: 1200,
        height: 628,
        background: "#000",
        border: "1px solid #1E1E1E",
        padding: "48px 56px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily: "'IBM Plex Mono', monospace",
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          position: "absolute",
          right: 120,
          top: "50%",
          transform: "translateY(-50%)",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ratingColor}14 0%, transparent 70%)`,
          pointerEvents: "none"
        }}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 32,
              fontWeight: 800,
              color: "#F5F5F5",
              letterSpacing: "-0.02em",
              marginBottom: 6
            }}
          >
            {companyName}
          </div>
          <div style={{ fontSize: 12, color: "#444", letterSpacing: "0.14em" }}>${ticker} · {sector.toUpperCase()}</div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#FFBF00", marginBottom: 4 }}>ELDAR SIGNAL</div>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#333" }}>
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 64 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>{scoreCircle(score, rating, 160)}</div>

        <div style={{ flex: 1, display: "flex", gap: 48 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#FFBF00", marginBottom: 14 }}>KEY DRIVERS</div>
            {drivers.slice(0, 4).map((d, i) => (
              <div key={`${d}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                <span style={{ color: "#10B981", marginTop: 1, flexShrink: 0 }}>↑</span>
                <span style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{d}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#555", marginBottom: 14 }}>KEY RISKS</div>
            {risks.slice(0, 3).map((r, i) => (
              <div key={`${r}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                <span style={{ color: "#EF4444", marginTop: 1, flexShrink: 0 }}>↓</span>
                <span style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>{r}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 42,
              fontWeight: 800,
              color: ratingColor,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              marginBottom: 8
            }}
          >
            {ratingLabel}
          </div>
          <div style={{ fontSize: 11, color: "#444", marginBottom: 4 }}>{confidence} CONFIDENCE</div>
          {scoreChange != null ? (
            <div style={{ fontSize: 10, color: scoreChange > 0 ? "#10B981" : "#EF4444" }}>
              {scoreChange > 0 ? "▲" : "▼"} {Math.abs(scoreChange).toFixed(1)} this quarter
            </div>
          ) : null}
          {sectorRank != null ? (
            <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>Top {sectorRank}% of sector</div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #1A1A1A",
          paddingTop: 20
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 160, height: 3, background: "#1A1A1A", borderRadius: 2, position: "relative" }}>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, (score / 10) * 100))}%`,
                height: "100%",
                background: ratingColor,
                borderRadius: 2
              }}
            />
          </div>
          <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.10em" }}>{score.toFixed(1)} / 10</span>
        </div>
        <div style={{ fontSize: 9, color: "#2A2A2A", letterSpacing: "0.14em" }}>ELDAR · Think like an analyst.</div>
      </div>
    </div>
  );
}
