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
        // Store accent colour, set per-site from /admin/home (see src/lib/accent.ts).
        "apple-blue": "rgb(var(--accent) / <alpha-value>)",
        "apple-blue-dark": "rgb(var(--accent-dark) / <alpha-value>)",
        "apple-blue-light": "rgb(var(--accent-light) / <alpha-value>)",
        "apple-blue-soft": "rgb(var(--accent-soft) / <alpha-value>)"
      },
      // Store corner setting from /admin/home (see src/lib/radius.ts). Tailwind's default
      // sizes times --radius-scale; outside the storefront the scale is 1.
      borderRadius: {
        sm: "calc(0.125rem * var(--radius-scale, 1))",
        DEFAULT: "calc(0.25rem * var(--radius-scale, 1))",
        md: "calc(0.375rem * var(--radius-scale, 1))",
        lg: "calc(0.5rem * var(--radius-scale, 1))",
        xl: "calc(0.75rem * var(--radius-scale, 1))",
        "2xl": "calc(1rem * var(--radius-scale, 1))",
        "3xl": "calc(1.5rem * var(--radius-scale, 1))",
        full: "var(--radius-full, 9999px)",
        // Dots, badges and round icons stay round whatever the setting.
        circle: "9999px"
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
