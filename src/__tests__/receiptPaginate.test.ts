import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT } from "@/lib/receipt/layout";
import { paginate, rowHeight, WRAP_LINE_HEIGHT } from "@/lib/receipt/paginate";

const measure = (text: string, size: number) => text.length * size * 0.5;
const lines = (count: number, name = "เสื้อ") => Array.from({ length: count }, (_, i) => ({ no: i + 1, name, quantity: 1, unitPrice: 10, amount: 10 }));

describe("receipt pagination", () => {
  it("fits three short lines on the last page", () => {
    const pages = paginate(lines(3), DEFAULT_LAYOUT, measure);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ pageNo: 1, pageCount: 1, isLast: true });
    expect(pages[0].rows.map(row => row.line.no)).toEqual([1, 2, 3]);
  });
  it("paginates thirty lines without losing or reordering rows", () => {
    const pages = paginate(lines(30), DEFAULT_LAYOUT, measure);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, index) => {
      expect(page).toMatchObject({ pageNo: index + 1, pageCount: pages.length, isLast: index === pages.length - 1 });
      expect(DEFAULT_LAYOUT.table.firstY + page.rows.reduce((sum, row) => sum + rowHeight(DEFAULT_LAYOUT.table, row.nameLines.length), 0)).toBeLessThanOrEqual(DEFAULT_LAYOUT.table.bottomY);
    });
    expect(pages.flatMap(page => page.rows.map(row => row.line.no))).toEqual(lines(30).map(line => line.no));
  });
  it("wraps long Thai names within the measured width", () => {
    const name = "เสื้อลายมหาวิทยาลัยแม่ฟ้าหลวงสำหรับนักศึกษาใหม่".repeat(4);
    const row = paginate(lines(1, name), DEFAULT_LAYOUT, measure)[0].rows[0];
    expect(row.nameLines.length).toBeGreaterThanOrEqual(2);
    expect(row.nameLines.join("")).toBe(name);
    row.nameLines.forEach(text => expect(measure(text, DEFAULT_LAYOUT.table.size)).toBeLessThanOrEqual(DEFAULT_LAYOUT.table.cols.name.width));
  });
  it("charges the full row height for the first line and 1.35x text size for each extra line", () => {
    const { table } = DEFAULT_LAYOUT;
    expect(rowHeight(table, 1)).toBe(table.rowSpacing);
    expect(rowHeight(table, 3)).toBeCloseTo(table.rowSpacing + 2 * table.size * WRAP_LINE_HEIGHT);
  });
  it("falls back to characters when Segmenter is unavailable", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    try {
      const name = "abcdefghij".repeat(8);
      const row = paginate(lines(1, name), DEFAULT_LAYOUT, measure)[0].rows[0];
      expect(row.nameLines.length).toBeGreaterThan(1);
      expect(row.nameLines.join("")).toBe(name);
    } finally { vi.unstubAllGlobals(); }
  });
  it("returns a final blank page for an empty receipt", () => {
    expect(paginate([], DEFAULT_LAYOUT, measure)).toEqual([{ rows: [], pageNo: 1, pageCount: 1, isLast: true }]);
  });
});
