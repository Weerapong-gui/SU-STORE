import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        "ink-soft": "#6e6e73",
        paper: "#ffffff",
        mist: "#f5f5f7",
        "apple-blue": "#0071e3",
        "apple-blue-dark": "#0058b0",
        "apple-blue-light": "#2997ff",
        "apple-blue-soft": "#e8f3ff"
      },
      boxShadow: {
        soft: "0 10px 40px rgba(0, 0, 0, 0.08)",
        card: "0 25px 80px rgba(0, 0, 0, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
