import { describe, it, expect } from "vitest";
import { EMPTY_FORM, formFromProduct, payloadFromForm, type Form } from "@/components/admin/product/productForm";
import type { StoreProduct, StoreVariant } from "@/types/store";

const designForm: Form = {
  ...EMPTY_FORM,
  name: "พวงกุญแจ",
  nameEn: "Keychain",
  categoryId: 3,
  optionKind: "designs",
  designPrice: "79",
  designRows: [{ key: "a", id: 7, designName: "ลาย", designNameEn: "", designCode: "sci", images: ["/x.png"], stock: "" }],
};

describe("payloadFromForm", () => {
  it("designs mode sends the kind with design variants only", () => {
    const p = payloadFromForm(designForm, false);
    expect(p).toMatchObject({ nameEn: "Keychain", categoryId: 3, optionKind: "designs" });
    expect(p.variants).toEqual([
      { id: 7, designCode: "SCI", designName: "ลาย", designNameEn: "", images: ["/x.png"], price: 79, stock: null, active: true },
    ]);
  });

  it("options mode sends no design fields", () => {
    const p = payloadFromForm({ ...EMPTY_FORM, rows: [{ size: "M", color: "", price: "350", stock: "5" }] }, false);
    expect(p.optionKind).toBe("options");
    expect(p.variants).toEqual([{ id: undefined, size: "M", color: "", price: 350, stock: 5, active: true }]);
  });
});

describe("formFromProduct", () => {
  it("loads a designs product into design rows and the shared price", () => {
    const variant = {
      id: 9, active: true, price: 79, stock: 4, size: "", color: "",
      designCode: "SCI", designName: "ลาย", designNameEn: "Sci", image: "/x.png", images: ["/x.png"],
    } as StoreVariant;
    const f = formFromProduct({ ...({} as StoreProduct), name: "ก", nameEn: "A", categoryId: 3, optionKind: "designs", slug: "k", description: "", buyerFields: [], status: "draft", saleStartsAt: null, saleEndsAt: null, variants: [variant] });
    expect(f.optionKind).toBe("designs");
    expect(f.designPrice).toBe("79");
    expect(f.designRows[0]).toMatchObject({ id: 9, designCode: "SCI", stock: "4" });
    expect(f.designRows[0].key).toBeTruthy();
    expect(f.rows).toHaveLength(1);
  });
});
