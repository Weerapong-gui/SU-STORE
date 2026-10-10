import type { StoreProduct } from "@/types/store";

// One editable row of the variant table. Price and stock stay strings while typing.
export type VariantRow = { id?: number; size: string; color: string; price: string; stock: string };

export const EMPTY_ROW: VariantRow = { size: "", color: "", price: "", stock: "" };

/** "S, M\nL" → ["S", "M", "L"] (trimmed, de-duplicated). */
export function splitList(text: string): string[] {
  return Array.from(new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)));
}

export function rowLabel(r: Pick<VariantRow, "size" | "color">): string {
  return [r.size, r.color].filter(Boolean).join(" / ") || "แบบเดียว (ไม่มีตัวเลือก)";
}

export function rowsFromProduct(p: StoreProduct): VariantRow[] {
  return p.variants
    .filter((v) => v.active)
    .map((v) => ({ id: v.id, size: v.size, color: v.color, price: String(v.price), stock: v.stock === null ? "" : String(v.stock) }));
}

export const uniqueValues = (rows: VariantRow[], key: "size" | "color") =>
  Array.from(new Set(rows.map((r) => r[key]).filter(Boolean)));

/**
 * The table for every size × colour combination. Existing rows are kept as they are;
 * new combinations get `defaultPrice` (or the first row's price) and unlimited stock.
 */
export function buildRows(sizes: string[], colors: string[], defaultPrice: string, current: VariantRow[]): VariantRow[] {
  const combos = (sizes.length ? sizes : [""]).flatMap((size) => (colors.length ? colors : [""]).map((color) => ({ size, color })));
  return combos.map(
    (c) =>
      current.find((r) => r.size === c.size && r.color === c.color) ?? {
        ...c,
        price: defaultPrice || current[0]?.price || "",
        stock: "",
      }
  );
}

/** Rows that `next` drops and that matter (saved before, or already priced). */
export function droppedRows(current: VariantRow[], next: VariantRow[]): VariantRow[] {
  return current.filter((r) => !next.includes(r) && (r.id !== undefined || r.price));
}

export function rowProblems(rows: VariantRow[]): string[] {
  return rows.flatMap((r) => [
    ...(/^\d+$/.test(r.price) ? [] : [`ราคาของ "${rowLabel(r)}" ต้องเป็นตัวเลขจำนวนเต็ม`]),
    ...(r.stock === "" || /^\d+$/.test(r.stock) ? [] : [`สต็อกของ "${rowLabel(r)}" ต้องเป็นตัวเลข หรือเว้นว่าง`]),
  ]);
}
