// Turns the store accent hex into the CSS variables behind the `apple-blue*` Tailwind
// colours (space-separated RGB channels so opacity modifiers like /20 keep working).

export const DEFAULT_ACCENT = "#0071e3";

type RGB = [number, number, number];

function parse(hex: string): RGB | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(color: RGB, target: number, amount: number): RGB {
  return color.map((c) => Math.round(c + (target - c) * amount)) as RGB;
}

const channels = (c: RGB) => c.join(" ");

export function accentVars(hex: string | undefined | null): Record<string, string> {
  const base = parse(hex ?? "") ?? (parse(DEFAULT_ACCENT) as RGB);
  return {
    "--accent": channels(base),
    "--accent-dark": channels(mix(base, 0, 0.22)),
    "--accent-light": channels(mix(base, 255, 0.18)),
    "--accent-soft": channels(mix(base, 255, 0.9)),
  };
}

// WCAG contrast of white text on the accent; the server rejects anything under 4.5.
export function contrastWithWhite(hex: string): number {
  const rgb = parse(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}
