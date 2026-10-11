// Turns the store's corner setting (0 = square, 100 = as designed) into the CSS
// variables behind Tailwind's `rounded-*` classes (see tailwind.config.ts). The admin
// never sets them, so it keeps the default corners.

// Same default as DEFAULT_RADIUS in server/store/home.py.
export const DEFAULT_RADIUS = 100;
// Pill buttons (`rounded-full`) shrink from this radius once the setting drops below 100,
// so they square off gradually instead of staying pills until 0.
const PILL_BELOW_FULL_REM = 1.5;

export function clampRadius(radius: number | undefined | null): number {
  if (typeof radius !== "number" || !Number.isFinite(radius)) return DEFAULT_RADIUS;
  return Math.min(100, Math.max(0, Math.round(radius)));
}

export function radiusVars(radius: number | undefined | null): Record<string, string> {
  const value = clampRadius(radius);
  const scale = value / 100;
  return {
    "--radius-scale": String(scale),
    "--radius-full": value === 100 ? "9999px" : `${PILL_BELOW_FULL_REM * scale}rem`,
  };
}
