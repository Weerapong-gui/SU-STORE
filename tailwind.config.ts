import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d1d1f",
        "ink-soft": "#6e6e73",
        "ink-tertiary": "#86868b",
        paper: "#ffffff",
        mist: "#f5f5f7",
        "surface-dark": "#1d1d1f",
        "apple-blue": "#0071e3",
        "apple-blue-dark": "#0058b0",
        "apple-blue-light": "#2997ff",
        "apple-blue-soft": "#e8f3ff"
      },
      boxShadow: {
        soft: "0 4px 24px rgba(0, 0, 0, 0.06)",
        card: "0 12px 48px rgba(0, 0, 0, 0.10)",
        "card-hover": "0 20px 60px rgba(0, 0, 0, 0.14)"
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "Helvetica Neue",
          "Arial",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};

export default config;
