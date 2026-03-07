export const ELDAR_TOKENS = {
  color: {
    bg: {
      base: "#0F1115",
      surface: "#1B1F27",
      raised: "#232833",
      drawer: "#151619"
    },
    text: {
      primary: "#F3F5F6",
      secondary: "#B8BAC2",
      muted: "#8B8F98"
    },
    border: {
      subtle: "rgba(226,231,238,0.12)",
      strong: "rgba(226,231,238,0.2)"
    },
    signal: {
      strongBuy: "#059669",
      buy: "#10B981",
      hold: "#6B7280",
      sell: "#EF4444",
      strongSell: "#B91C1C",
      amber: "#FFBF00"
    }
  },
  spacing: {
    8: "8px",
    16: "16px",
    24: "24px",
    32: "32px",
    48: "48px",
    64: "64px"
  },
  radius: {
    card: "18px",
    input: "12px",
    pill: "999px"
  },
  border: {
    default: "1px solid rgba(226,231,238,0.12)"
  },
  motion: {
    fast: "150ms",
    base: "180ms",
    slow: "220ms",
    ease: "cubic-bezier(0.22, 1, 0.36, 1)"
  }
} as const;

export type EldarTokens = typeof ELDAR_TOKENS;
