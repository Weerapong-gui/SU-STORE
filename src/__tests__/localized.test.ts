import { describe, expect, it } from "vitest";
import { localized, orderItemText, variantDisplayLabel } from "@/lib/localized";

describe("localized", () => {
  it("selects English and falls back to Thai", () => {
    expect(localized("พวงกุญแจ", "", "en")).toBe("พวงกุญแจ");
    expect(localized("พวงกุญแจ", "Keychain", "en")).toBe("Keychain");
    expect(localized("พวงกุญแจ", null, "en")).toBe("พวงกุญแจ");
    expect(localized("พวงกุญแจ", undefined, "en")).toBe("พวงกุญแจ");
  });
  it("selects Thai and falls back to English", () => {
    expect(localized("พวงกุญแจ", "Keychain", "th")).toBe("พวงกุญแจ");
    expect(localized("", "Keychain", "th")).toBe("Keychain");
    expect(localized("", "", "th")).toBe("");
  });
});

describe("order and cart display text", () => {
  const item = {
    variantId: 1, productId: 1, productName: "เสื้อ", productNameEn: null,
    variantLabel: "A01 · ลายดอกไม้", variantLabelEn: null, unitPrice: 100, quantity: 1, lineTotal: 100,
  };
  it("shows the Thai name under en when the order has no English fields", () => {
    expect(orderItemText(item, "en")).toEqual({ name: "เสื้อ", label: "A01 · ลายดอกไม้" });
  });
  it("uses English text when present and hides a '-' label", () => {
    expect(orderItemText({ ...item, productNameEn: "Shirt", variantLabelEn: "A01 · Flower" }, "en"))
      .toEqual({ name: "Shirt", label: "A01 · Flower" });
    expect(orderItemText({ ...item, variantLabel: "-" }, "th").label).toBe("");
  });
  const base = { id: 1, size: "", color: "", label: "-", price: 1, stock: null, sku: "", active: true, soldOut: false, image: "", images: [] };
  it("labels design variants as code and localized name, options variants by label", () => {
    const design = { ...base, designCode: "A01", designName: "ดอกไม้", designNameEn: "Flower" };
    expect(variantDisplayLabel(design, "en")).toBe("A01 · Flower");
    expect(variantDisplayLabel(design, "th")).toBe("A01 · ดอกไม้");
    expect(variantDisplayLabel({ ...base, designCode: "", designName: "", designNameEn: "", label: "M" }, "en")).toBe("M");
    expect(variantDisplayLabel({ ...base, designCode: "", designName: "", designNameEn: "" }, "en")).toBe("");
  });
});
