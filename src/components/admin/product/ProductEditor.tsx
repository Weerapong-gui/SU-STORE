"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Badge, Button, Card, Field, inputClass, PRODUCT_STATUS_LABEL, useToast } from "@/components/admin/ui";
import type { ProductStatus, StoreMeta, StoreProduct } from "@/types/store";
import { ImagesCard } from "./ImagesCard";
import { VariantsCard } from "./VariantsCard";
import { EMPTY_ROW, rowProblems, rowsFromProduct, type VariantRow } from "./variants";

const STATUS_HELP: Record<ProductStatus, string> = {
  draft: "ยังไม่แสดงบนหน้าร้าน ใช้ระหว่างเตรียมข้อมูล",
  active: "แสดงบนหน้าร้าน ลูกค้าสั่งซื้อได้",
  archived: "ซ่อนจากหน้าร้าน แต่ออเดอร์เก่ายังอยู่ครบ",
};

type Form = {
  name: string;
  slug: string;
  description: string;
  rows: VariantRow[];
  buyerFields: string[];
  status: ProductStatus;
  saleStartsAt: string;
  saleEndsAt: string;
};

const EMPTY_FORM: Form = {
  name: "",
  slug: "",
  description: "",
  rows: [EMPTY_ROW],
  buyerFields: [],
  status: "draft",
  saleStartsAt: "",
  saleEndsAt: "",
};

function formFromProduct(p: StoreProduct): Form {
  const rows = rowsFromProduct(p);
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    rows: rows.length ? rows : [EMPTY_ROW],
    buyerFields: p.buyerFields,
    status: p.status,
    // Stored as Bangkok-time ISO (+07:00); datetime-local wants "YYYY-MM-DDTHH:mm".
    saleStartsAt: p.saleStartsAt?.slice(0, 16) ?? "",
    saleEndsAt: p.saleEndsAt?.slice(0, 16) ?? "",
  };
}

function formProblems(form: Form): string[] {
  return [
    ...(form.name.trim() ? [] : ["ยังไม่ได้ใส่ชื่อสินค้า"]),
    ...rowProblems(form.rows),
    ...(form.status === "active" && form.rows.length === 0 ? ["ต้องมีตัวเลือกอย่างน้อย 1 แบบก่อนเปิดขาย"] : []),
    ...(form.saleStartsAt && form.saleEndsAt && form.saleEndsAt <= form.saleStartsAt ? ["เวลาปิดขายต้องอยู่หลังเวลาเปิดขาย"] : []),
  ];
}

function payloadFromForm(form: Form, isNew: boolean) {
  return {
    name: form.name,
    description: form.description,
    buyerFields: form.buyerFields,
    status: form.status,
    saleStartsAt: form.saleStartsAt || null,
    saleEndsAt: form.saleEndsAt || null,
    variants: form.rows.map((r) => ({
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

export function ProductEditor({ productId }: { productId?: number }) {
  const router = useRouter();
  const toast = useToast();
  const isNew = productId === undefined;

  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [images, setImages] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback((p: StoreProduct) => {
    setProduct(p);
    setForm(formFromProduct(p));
    setImages(p.images);
    setDirty(false);
  }, []);

  useEffect(() => {
    adminFetch<StoreMeta>("meta")
      .then(setMeta)
      .catch((e: Error) => toast(e.message, "error"));
    if (!isNew) {
      adminFetch<StoreProduct>(`products/${productId}`)
        .then(load)
        .catch((e: Error) => toast(e.message, "error"));
    }
  }, [isNew, productId, load, toast]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const problems = useMemo(() => formProblems(form), [form]);

  async function save() {
    if (problems.length) {
      toast(problems[0], "error");
      return;
    }
    setSaving(true);
    const payload = payloadFromForm(form, isNew);
    try {
      const saved = isNew
        ? await adminFetch<StoreProduct>("products", { method: "POST", json: payload })
        : await adminFetch<StoreProduct>(`products/${productId}`, { method: "PUT", json: payload });
      setDirty(false);
      toast("บันทึกแล้ว");
      if (isNew) router.replace(`/admin/products/${saved.id}`);
      else load(saved);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`ลบ "${form.name}" ใช่ไหม?\n(ถ้าเคยมีคนสั่งแล้ว ระบบจะเปลี่ยนเป็น "ปิดการขาย" แทนการลบ)`)) return;
    try {
      const result = await adminFetch<{ deleted: boolean; archived: boolean }>(`products/${productId}`, { method: "DELETE" });
      toast(result.deleted ? "ลบสินค้าแล้ว" : "มีออเดอร์อยู่แล้ว จึงเปลี่ยนเป็นปิดการขายแทน");
      setDirty(false);
      router.push("/admin/products");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!isNew && !product) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  const optionalFields = meta?.buyerFields.filter((f) => !f.alwaysRequired) ?? [];
  const requiredFields = meta?.buyerFields.filter((f) => f.alwaysRequired) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/products" className="text-sm text-zinc-500 hover:underline">
          ← สินค้าทั้งหมด
        </Link>
        <h1 className="text-2xl font-bold">{isNew ? "เพิ่มสินค้าใหม่" : form.name || "แก้ไขสินค้า"}</h1>
        {product && <Badge kind="product" status={product.status} />}
      </div>

      <Card step={1} title="ข้อมูลสินค้า" hint="ชื่อและรายละเอียดที่ลูกค้าจะเห็นบนหน้าร้าน">
        <div className="space-y-4">
          <Field label="ชื่อสินค้า *">
            <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น เสื้อฮู้ด SU 2026" />
          </Field>
          {isNew ? (
            <Field
              label="ชื่อในลิงก์ (ไม่บังคับ)"
              hint="ภาษาอังกฤษ ตัวเลข และขีด เช่น su-hoodie-2026 · ถ้าเว้นว่าง ระบบสร้างจากชื่อสินค้าให้ · ตั้งแล้วเปลี่ยนไม่ได้"
            >
              <input className={inputClass} value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="su-hoodie-2026" />
            </Field>
          ) : (
            <p className="text-xs text-zinc-500">
              ลิงก์สินค้า: <code className="rounded bg-zinc-100 px-1.5 py-0.5">/products/{form.slug}</code>
            </p>
          )}
          <Field label="รายละเอียด" hint="เนื้อผ้า วิธีวัดไซซ์ วัน-เวลารับของ ฯลฯ">
            <textarea className={`${inputClass} min-h-28`} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </div>
      </Card>

      <ImagesCard productId={productId} images={images} onChange={setImages} />

      {/* Remount after each load so the size/colour inputs reflect the saved variants. */}
      <VariantsCard key={product?.updatedAt ?? "new"} rows={form.rows} onChange={(rows) => set("rows", rows)} />

      <Card step={4} title="ข้อมูลที่ต้องการจากผู้ซื้อ" hint="ผู้ซื้อต้องกรอกช่องที่เลือกก่อนสั่งซื้อ">
        <p className="mb-3 text-sm text-zinc-600">บังคับทุกออเดอร์อยู่แล้ว: {requiredFields.map((f) => f.label).join(", ")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {optionalFields.map((f) => (
            <label key={f.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 hover:bg-zinc-50">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.buyerFields.includes(f.key)}
                onChange={(e) =>
                  set("buyerFields", e.target.checked ? [...form.buyerFields, f.key] : form.buyerFields.filter((k) => k !== f.key))
                }
              />
              <span className="text-sm">{f.label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card step={5} title="สถานะการขาย">
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(STATUS_HELP) as ProductStatus[]).map((s) => (
            <label
              key={s}
              className={`cursor-pointer rounded-xl border px-4 py-3 ${form.status === s ? "border-zinc-900 ring-2 ring-zinc-200" : "border-zinc-200 hover:bg-zinc-50"}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <input type="radio" name="status" checked={form.status === s} onChange={() => set("status", s)} />
                {PRODUCT_STATUS_LABEL[s]}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">{STATUS_HELP[s]}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 grid gap-4 border-t border-zinc-100 pt-5 sm:grid-cols-2">
          <Field label="เปิดขายตั้งแต่ (ไม่บังคับ)" hint="ก่อนเวลานี้ลูกค้าเห็นสินค้าแต่ยังสั่งไม่ได้ · เว้นว่าง = ขายได้ทันที">
            <input type="datetime-local" className={inputClass} value={form.saleStartsAt} onChange={(e) => set("saleStartsAt", e.target.value)} />
          </Field>
          <Field label="ปิดขายเมื่อ (ไม่บังคับ)" hint="หลังเวลานี้ปิดรับสั่งอัตโนมัติ · เว้นว่าง = ไม่มีกำหนดปิด">
            <input type="datetime-local" className={inputClass} value={form.saleEndsAt} onChange={(e) => set("saleEndsAt", e.target.value)} />
          </Field>
          <p className="text-xs text-zinc-500 sm:col-span-2">เวลาเป็นเวลาประเทศไทย และมีผลเฉพาะเมื่อสถานะเป็น &quot;เปิดขาย&quot;</p>
        </div>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          {problems.length > 0 ? (
            <p className="text-sm text-amber-700">⚠ {problems[0]}</p>
          ) : dirty ? (
            <p className="text-sm text-zinc-600">มีการแก้ไขที่ยังไม่บันทึก</p>
          ) : (
            <p className="text-sm text-zinc-400">บันทึกล่าสุดแล้ว</p>
          )}
          <div className="ml-auto flex gap-2">
            {!isNew && (
              <Button variant="ghost" className="text-red-600" onClick={remove}>
                ลบสินค้า
              </Button>
            )}
            <Button onClick={save} disabled={saving}>
              {saving ? "กำลังบันทึก..." : isNew ? "บันทึก" : "บันทึกการแก้ไข"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
