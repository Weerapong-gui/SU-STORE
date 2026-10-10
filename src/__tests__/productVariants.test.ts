import { describe, it, expect } from "vitest";
import { buildRows, droppedRows, rowProblems, splitList, type VariantRow } from "@/components/admin/product/variants";

describe("product variant table", () => {
  it("splits and de-duplicates lists", () => {
    expect(splitList("S, M\nM ,L,")).toEqual(["S", "M", "L"]);
  });

  it("builds every size × colour, keeping existing rows and pricing new ones", () => {
    const existing: VariantRow = { id: 7, size: "M", color: "Black", price: "300", stock: "4" };
    const rows = buildRows(["M", "L"], ["Black"], "", [existing]);
    expect(rows).toEqual([existing, { size: "L", color: "Black", price: "300", stock: "" }]);
  });

  it("reports saved or priced rows that a rebuild would drop", () => {
    const saved: VariantRow = { id: 1, size: "S", color: "", price: "100", stock: "" };
    const blank: VariantRow = { size: "XS", color: "", price: "", stock: "" };
    const next = buildRows(["M"], [], "100", [saved, blank]);
    expect(droppedRows([saved, blank], next)).toEqual([saved]);
  });

  it("flags non-integer prices and stock", () => {
    expect(rowProblems([{ size: "M", color: "", price: "1.5", stock: "x" }])).toHaveLength(2);
    expect(rowProblems([{ size: "M", color: "", price: "150", stock: "" }])).toEqual([]);
  });
});
