import { describe, it, expect } from "vitest";
import { designPayload, designRowProblems, type DesignRow } from "@/components/admin/product/designRows";

const row = (patch: Partial<DesignRow> = {}): DesignRow => ({
  designName: "ลายหนึ่ง",
  designNameEn: "",
  designCode: "SCI",
  image: "",
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
});
