import { ratingColor } from "@/lib/rating";
import type { RatingLabel } from "@/lib/types";

export function getRatingColor(rating: RatingLabel): string {
  return ratingColor(rating);
}

export function scoreCircle(
  score: number,
  rating: RatingLabel,
  size: number
): JSX.Element {
  const color = getRatingColor(rating);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        background: "#0A0A0A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 0 0 1px ${color}22 inset`
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
            fontSize: size >= 140 ? 48 : size >= 100 ? 32 : 22,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: color,
            lineHeight: 1
          }}
        >
          {score.toFixed(1)}
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: "'Neue Haas Grotesk Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
            fontSize: 9,
            letterSpacing: "0.12em",
            color: "#444"
          }}
        >
          /10
        </div>
      </div>
    </div>
  );
}
