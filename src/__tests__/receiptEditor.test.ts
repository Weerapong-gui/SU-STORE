import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "@/lib/receipt/layout";
import {
  fieldBox, moveSelection, nudgeRows, nudgeSelection, pxToViewBox, resizeSelection, RECEIPT_VIEWBOX, type Selection,
} from "@/lib/receipt/editorMath";

const dateField: Selection = { kind: "field", key: "date" };

describe("pxToViewBox", () => {
  it("maps the corners and centre of the rendered box to viewBox units", () => {
    const rect = { left: 100, top: 50, width: 406.49, height: 298.56 };
    expect(pxToViewBox(100, 50, rect)).toEqual({ x: 0, y: 0 });
    const end = pxToViewBox(506.49, 348.56, rect);
    expect(end.x).toBeCloseTo(RECEIPT_VIEWBOX.width);
    expect(end.y).toBeCloseTo(RECEIPT_VIEWBOX.height);
    expect(pxToViewBox(303.245, 199.28, rect).x).toBeCloseTo(RECEIPT_VIEWBOX.width / 2);
  });
});

describe("nudgeSelection", () => {
  it("moves a field by 0.5 units per press", () => {
    const next = nudgeSelection(DEFAULT_LAYOUT, dateField, 1, -1);
    expect(next.fields.date.x).toBe(DEFAULT_LAYOUT.fields.date.x + 0.5);
    expect(next.fields.date.y).toBe(DEFAULT_LAYOUT.fields.date.y - 0.5);
  });

  it("does not mutate the previous layout", () => {
    nudgeSelection(DEFAULT_LAYOUT, dateField, 1, 1);
    expect(DEFAULT_LAYOUT.fields.date.x).toBe(384);
  });

  it("moves columns horizontally only", () => {
    const next = nudgeSelection(DEFAULT_LAYOUT, { kind: "col", key: "qty" }, 1, 1);
    expect(next.table.cols.qty.x).toBe(DEFAULT_LAYOUT.table.cols.qty.x + 0.5);
    expect(next.table).toMatchObject({ firstY: DEFAULT_LAYOUT.table.firstY });
  });

  it("moves the signature", () => {
    const next = nudgeSelection(DEFAULT_LAYOUT, { kind: "signature" }, -1, 1);
    expect(next.signature).toMatchObject({ x: 29.5, y: 500.5, width: 62 });
  });
});

describe("moveSelection clamping and snapping", () => {
  it("clamps to the viewBox", () => {
    const next = moveSelection(DEFAULT_LAYOUT, dateField, { x: -20, y: 9999 });
    expect(next.fields.date).toMatchObject({ x: 0, y: RECEIPT_VIEWBOX.height });
  });

  it("snaps drags to the 0.5 grid", () => {
    expect(moveSelection(DEFAULT_LAYOUT, dateField, { x: 100.3, y: 40.8 }).fields.date).toMatchObject({ x: 100.5, y: 41 });
  });
});

describe("resizeSelection", () => {
  it("steps the field size by 0.5 and clamps to the server range 4-30", () => {
    expect(resizeSelection(DEFAULT_LAYOUT, dateField, 1).fields.date.size).toBe(10);
    let layout = DEFAULT_LAYOUT;
    for (let i = 0; i < 80; i++) layout = resizeSelection(layout, dateField, -1);
    expect(layout.fields.date.size).toBe(4);
    for (let i = 0; i < 120; i++) layout = resizeSelection(layout, dateField, 1);
    expect(layout.fields.date.size).toBe(30);
  });

  it("changes the table text size for a column and the width for the signature", () => {
    expect(resizeSelection(DEFAULT_LAYOUT, { kind: "col", key: "no" }, 1).table.size).toBe(8);
    expect(resizeSelection(DEFAULT_LAYOUT, { kind: "signature" }, -1).signature.width).toBe(61.5);
  });
});

describe("nudgeRows", () => {
  it("moves the first row and the spacing independently", () => {
    const next = nudgeRows(DEFAULT_LAYOUT, 1, -1);
    expect(next.table.firstY).toBe(197.5);
    expect(next.table.rowSpacing).toBe(24.5);
  });
});

describe("fieldBox", () => {
  it("places the box by anchor with the baseline at y", () => {
    const base = { x: 100, y: 50, size: 10 };
    expect(fieldBox({ ...base, anchor: "start" }, 40)).toMatchObject({ x: 100, y: 40, width: 40 });
    expect(fieldBox({ ...base, anchor: "middle" }, 40).x).toBe(80);
    expect(fieldBox({ ...base, anchor: "end" }, 40).x).toBe(60);
  });
});
