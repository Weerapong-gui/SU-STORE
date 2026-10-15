import { describe, it, expect } from "vitest";
import {
  designPayload,
  designRowProblems,
  designRowsFromProduct,
  moveImage,
  removeImage,
  type DesignRow,
} from "@/components/admin/product/designRows";
import type { StoreProduct, StoreVariant } from "@/types/store";

const row = (patch: Partial<DesignRow> = {}): DesignRow => ({
  key: "k",
  designName: "ลายหนึ่ง",
  designNameEn: "",
  designCode: "SCI",
  images: [],
  stock: "",
  ...patch,
});

describe("design rows", () => {
  it("accepts a valid table", () => {
    expect(designRowProblems([row(), row({ designCode: "AGRO" })], "79")).toEqual([]);
  });

  it("requires a price", () => {
    expect(designRowProblems([row()], "")).toEqual(["ยังไม่ได้ใส่ราคา"]);
  });

  it("requires a Thai name and a code, numbered by row", () => {
    expect(designRowProblems([row(), row({ designName: " ", designCode: "" })], "79")).toEqual([
      "ลายแถวที่ 2 ยังไม่มีชื่อไทย",
      "ลายแถวที่ 2 ยังไม่มีตัวย่อ",
    ]);
  });

  it("flags duplicate codes case-insensitively, once per code", () => {
    expect(designRowProblems([row(), row({ designCode: "sci" }), row({ designCode: "Sci" })], "79")).toEqual(["ตัวย่อ SCI ซ้ำกัน"]);
  });

  it("uppercases the code, copies the price and sends blank stock as null", () => {
    const [a, b] = designPayload([row({ id: 5, designCode: "sci", stock: "4" }), row({ designCode: "agro" })], "79");
    expect(a).toMatchObject({ id: 5, designCode: "SCI", price: 79, stock: 4, active: true });
    expect(b).toMatchObject({ designCode: "AGRO", price: 79, stock: null });
  });

  it("moves and removes images", () => {
    expect(moveImage(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveImage(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveImage(["a", "b"], 1, 2)).toEqual(["a", "b"]);
    expect(removeImage(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("builds rows and payload with images", () => {
    const variant = { id: 3, active: true, designName: "ลาย", designNameEn: "", designCode: "SCI", image: "a", images: ["a", "b"], stock: null, price: 49 } as StoreVariant;
    const [r] = designRowsFromProduct({ variants: [variant] } as StoreProduct);
    expect(r.images).toEqual(["a", "b"]);
    expect(designPayload([r], "49")[0].images).toEqual(["a", "b"]);
  });
});
