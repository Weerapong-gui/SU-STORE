import type { ReceiptField, ReceiptLayout } from "@/types/store";

// Same viewBox as server/templates/receipt_template_v2.svg.
export const RECEIPT_VIEWBOX = { width: 812.98, height: 597.12 };
// The server rejects layout numbers outside these bounds (server/store/receipts.py _validate_layout).
export const LAYOUT_MAX = 1000;
export const FONT_SIZE_MIN = 4;
export const FONT_SIZE_MAX = 30;
export const NUDGE_STEP = 0.5;
const MIN_SIGNATURE_WIDTH = 10;
const TEXT_HEIGHT_RATIO = 1.2;

export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Selection =
  | { kind: "field"; key: keyof ReceiptLayout["fields"] }
  | { kind: "signature" }
  | { kind: "col"; key: keyof ReceiptLayout["table"]["cols"] };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snap(value: number): number {
  return Math.round(value / NUDGE_STEP) * NUDGE_STEP;
}

// Pointer pixels -> viewBox units, using the on-screen bounding box of the overlay SVG.
export function pxToViewBox(clientX: number, clientY: number, rect: Rect): Point {
  return {
    x: ((clientX - rect.left) / rect.width) * RECEIPT_VIEWBOX.width,
    y: ((clientY - rect.top) / rect.height) * RECEIPT_VIEWBOX.height,
  };
}

// Extent of text drawn at `field`, given its measured width. y is the baseline.
export function fieldBox(field: ReceiptField, textWidth: number): { x: number; y: number; width: number; height: number } {
  const left = field.anchor === "start" ? field.x : field.anchor === "middle" ? field.x - textWidth / 2 : field.x - textWidth;
  return { x: left, y: field.y - field.size, width: textWidth, height: field.size * TEXT_HEIGHT_RATIO };
}

const clampX = (value: number) => clamp(snap(value), 0, RECEIPT_VIEWBOX.width);
const clampY = (value: number) => clamp(snap(value), 0, RECEIPT_VIEWBOX.height);
const clampSize = (value: number) => clamp(value, FONT_SIZE_MIN, FONT_SIZE_MAX);

// Returns a new layout with the selection moved to `to`; columns only move horizontally.
export function moveSelection(layout: ReceiptLayout, selection: Selection, to: Point): ReceiptLayout {
  if (selection.kind === "field") {
    const field = layout.fields[selection.key];
    return { ...layout, fields: { ...layout.fields, [selection.key]: { ...field, x: clampX(to.x), y: clampY(to.y) } } };
  }
  if (selection.kind === "signature") {
    return { ...layout, signature: { ...layout.signature, x: clampX(to.x), y: clampY(to.y) } };
  }
  const col = layout.table.cols[selection.key];
  const cols = { ...layout.table.cols, [selection.key]: { ...col, x: clampX(to.x) } };
  return { ...layout, table: { ...layout.table, cols } };
}

export function selectionOrigin(layout: ReceiptLayout, selection: Selection): Point {
  if (selection.kind === "field") return layout.fields[selection.key];
  if (selection.kind === "signature") return layout.signature;
  return { x: layout.table.cols[selection.key].x, y: 0 };
}

export function nudgeSelection(layout: ReceiptLayout, selection: Selection, dx: number, dy: number): ReceiptLayout {
  const origin = selectionOrigin(layout, selection);
  return moveSelection(layout, selection, { x: origin.x + dx * NUDGE_STEP, y: origin.y + dy * NUDGE_STEP });
}

// A-/A+ change the field text size, the table text size (columns) or the signature width.
export function resizeSelection(layout: ReceiptLayout, selection: Selection, direction: 1 | -1): ReceiptLayout {
  const delta = direction * NUDGE_STEP;
  if (selection.kind === "field") {
    const field = layout.fields[selection.key];
    return { ...layout, fields: { ...layout.fields, [selection.key]: { ...field, size: clampSize(field.size + delta) } } };
  }
  if (selection.kind === "signature") {
    const width = clamp(layout.signature.width + delta, MIN_SIGNATURE_WIDTH, LAYOUT_MAX);
    return { ...layout, signature: { ...layout.signature, width } };
  }
  return { ...layout, table: { ...layout.table, size: clampSize(layout.table.size + delta) } };
}

export function nudgeRows(layout: ReceiptLayout, firstY: number, rowSpacing: number): ReceiptLayout {
  const table = layout.table;
  return {
    ...layout,
    table: {
      ...table,
      firstY: clamp(table.firstY + firstY * NUDGE_STEP, 0, LAYOUT_MAX),
      rowSpacing: clamp(table.rowSpacing + rowSpacing * NUDGE_STEP, NUDGE_STEP, LAYOUT_MAX),
    },
  };
}

export const ARROW_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};
