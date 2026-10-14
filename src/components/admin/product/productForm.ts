import type { ProductStatus, StoreProduct } from "@/types/store";
import { designPayload, designPriceFromProduct, designRowProblems, designRowsFromProduct, type DesignRow } from "./designRows";
import { EMPTY_ROW, rowProblems, rowsFromProduct, type VariantRow } from "./variants";

export type Form = {
  name: string;
  nameEn: string;
  categoryId: number | null;
  optionKind: StoreProduct["optionKind"];
  slug: string;
  description: string;
  rows: VariantRow[];
  designRows: DesignRow[];
  designPrice: string;
  buyerFields: string[];
  status: ProductStatus;
  saleStartsAt: string;
  saleEndsAt: string;
};

export const EMPTY_FORM: Form = {
  name: "",
  nameEn: "",
  categoryId: null,
  optionKind: "options",
  slug: "",
  description: "",
  rows: [EMPTY_ROW],
  designRows: [],
  designPrice: "",
  buyerFields: [],
  status: "draft",
  saleStartsAt: "",
  saleEndsAt: "",
};

export function formFromProduct(p: StoreProduct): Form {
  const isDesigns = p.optionKind === "designs";
  const rows = isDesigns ? [] : rowsFromProduct(p);
  return {
    name: p.name,
    nameEn: p.nameEn,
    categoryId: p.categoryId,
    optionKind: p.optionKind,
    slug: p.slug,
    description: p.description,
    rows: rows.length ? rows : [EMPTY_ROW],
    designRows: isDesigns ? designRowsFromProduct(p) : [],
    designPrice: isDesigns ? designPriceFromProduct(p) : "",
    buyerFields: p.buyerFields,
    status: p.status,
    // Stored as Bangkok-time ISO (+07:00); datetime-local wants "YYYY-MM-DDTHH:mm".
    saleStartsAt: p.saleStartsAt?.slice(0, 16) ?? "",
    saleEndsAt: p.saleEndsAt?.slice(0, 16) ?? "",
  };
}

export function formProblems(form: Form): string[] {
  const optionCount = form.optionKind === "designs" ? form.designRows.length : form.rows.length;
  return [
    ...(form.name.trim() ? [] : ["ยังไม่ได้ใส่ชื่อสินค้า"]),
    ...(form.optionKind === "designs" ? designRowProblems(form.designRows, form.designPrice) : rowProblems(form.rows)),
    ...(form.status === "active" && optionCount === 0 ? ["ต้องมีตัวเลือกอย่างน้อย 1 แบบก่อนเปิดขาย"] : []),
    ...(form.saleStartsAt && form.saleEndsAt && form.saleEndsAt <= form.saleStartsAt ? ["เวลาปิดขายต้องอยู่หลังเวลาเปิดขาย"] : []),
  ];
}

export function payloadFromForm(form: Form, isNew: boolean) {
  return {
    name: form.name,
    nameEn: form.nameEn,
    categoryId: form.categoryId,
    description: form.description,
    buyerFields: form.buyerFields,
    status: form.status,
    saleStartsAt: form.saleStartsAt || null,
    saleEndsAt: form.saleEndsAt || null,
    // optionKind and variants always travel together: the server flips the kind without touching variants otherwise.
    optionKind: form.optionKind,
    variants:
      form.optionKind === "designs"
        ? designPayload(form.designRows, form.designPrice)
        : form.rows.map((r) => ({
            id: r.id,
            size: r.size,
            color: r.color,
            price: Number(r.price),
            stock: r.stock === "" ? null : Number(r.stock),
            active: true,
          })),
    ...(isNew && form.slug.trim() ? { slug: form.slug } : {}),
  };
}
