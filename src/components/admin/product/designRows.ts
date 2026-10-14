import type { StoreProduct } from "@/types/store";

// One editable row of the designs table. Stock stays a string while typing.
export type DesignRow = { id?: number; designName: string; designNameEn: string; designCode: string; image: string; stock: string };

export const EMPTY_DESIGN_ROW: DesignRow = { designName: "", designNameEn: "", designCode: "", image: "", stock: "" };

// Mirrors the server's design-code rule (A-Z, 0-9 and "-"), applied while typing.
export const cleanDesignCode = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9-]/g, "");

export function designRowsFromProduct(p: StoreProduct): DesignRow[] {
  return p.variants
    .filter((v) => v.active)
    .map((v) => ({
      id: v.id,
      designName: v.designName,
      designNameEn: v.designNameEn,
      designCode: v.designCode,
      image: v.image,
      stock: v.stock === null ? "" : String(v.stock),
    }));
}

/** Price shared by every design: the first saved design's price, or blank. */
export function designPriceFromProduct(p: StoreProduct): string {
  const first = p.variants.find((v) => v.active);
  return first ? String(first.price) : "";
}

export function designRowProblems(rows: DesignRow[], price: string): string[] {
  const problems: string[] = [];
  if (!/^\d+$/.test(price.trim())) problems.push("ยังไม่ได้ใส่ราคา");
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const n = i + 1;
    const code = r.designCode.trim().toUpperCase();
    if (!r.designName.trim()) problems.push(`ลายแถวที่ ${n} ยังไม่มีชื่อไทย`);
    if (!code) problems.push(`ลายแถวที่ ${n} ยังไม่มีตัวย่อ`);
    else seen.set(code, (seen.get(code) ?? 0) + 1);
    if (r.stock !== "" && !/^\d+$/.test(r.stock)) problems.push(`สต็อกของลายแถวที่ ${n} ต้องเป็นตัวเลข หรือเว้นว่าง`);
  });
  seen.forEach((count, code) => {
    if (count > 1) problems.push(`ตัวย่อ ${code} ซ้ำกัน`);
  });
  return problems;
}

export function designPayload(rows: DesignRow[], price: string) {
  return rows.map((r) => ({
    id: r.id,
    designCode: r.designCode.trim().toUpperCase(),
    designName: r.designName.trim(),
    designNameEn: r.designNameEn.trim(),
    image: r.image,
    price: Number(price),
    stock: r.stock === "" ? null : Number(r.stock),
    active: true,
  }));
}
