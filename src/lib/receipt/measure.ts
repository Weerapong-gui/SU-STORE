import { FONT } from "./render";

export type Measure = (text: string, size: number) => number;

// Rough width when no canvas is available (SSR, very old browsers).
const FALLBACK_EM_WIDTH = 0.55;

// Uses the renderer's own font stack so wrapping in the preview matches what prints.
export function createCanvasMeasure(): Measure {
  const context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!context) return (text, size) => text.length * size * FALLBACK_EM_WIDTH;
  return (text, size) => {
    context.font = `${size}px ${FONT}`;
    return context.measureText(text).width;
  };
}
