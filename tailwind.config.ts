import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        bullish: "#22C55E",
        hold: "#FFBF00",
        bearish: "#EF4444",
        ink: "#000000",
        panel: "#1A1A1A",
        panelSoft: "#242424"
      },
      boxShadow: {
        glow: "0 10px 40px rgba(16, 185, 129, 0.15)",
        redglow: "0 10px 40px rgba(239, 68, 68, 0.18)"
      }
    }
  },
  plugins: []
};

export default config;
