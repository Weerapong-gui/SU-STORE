import type { StoreProduct } from "@/types/store";

// One editable row of the designs table. Stock stays a string while typing.
// `key` is a client-only identity (never sent to the server) so async results find their row after reorders/deletes.
export type DesignRow = { key: string; id?: number; designName: string; designNameEn: string; designCode: string; images: string[]; stock: string };

// Mirrors MAX_DESIGN_IMAGES in server/store/designs.py.
export const MAX_DESIGN_IMAGES = 8;

export const newDesignRow = (): DesignRow => ({
  key: crypto.randomUUID(),
  designName: "",
  designNameEn: "",
  designCode: "",
  images: [],
  stock: "",
});

/** Functional row update, so late results apply to the rows as they are now. */
export type DesignRowsUpdate = (update: (rows: DesignRow[]) => DesignRow[]) => void;

// Mirrors the server's design-code rule (A-Z, 0-9 and "-"), applied while typing.
export const cleanDesignCode = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9-]/g, "");

/** Moves one image to another position; the first image is the design's main image. */
export function moveImage(images: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= images.length || to < 0 || to >= images.length) return images;
  const next = [...images];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export const removeImage = (images: string[], index: number): string[] => images.filter((_, i) => i !== index);

export function designRowsFromProduct(p: StoreProduct): DesignRow[] {
  return p.variants
    .filter((v) => v.active)
    .map((v) => ({
      key: crypto.randomUUID(),
      id: v.id,
      designName: v.designName,
      designNameEn: v.designNameEn,
      designCode: v.designCode,
      images: v.images,
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
    images: r.images,
    price: Number(price),
    stock: r.stock === "" ? null : Number(r.stock),
    active: true,
  }));
}
