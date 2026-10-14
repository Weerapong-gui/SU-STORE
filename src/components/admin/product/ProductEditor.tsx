"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Badge, Button, Card, Field, inputClass, PRODUCT_STATUS_LABEL, useToast } from "@/components/admin/ui";
import type { ProductStatus, StoreCategory, StoreMeta, StoreProduct } from "@/types/store";
import { ImagesCard } from "./ImagesCard";
import { OptionsStep } from "./OptionsStep";
import { newDesignRow, type DesignRowsUpdate } from "./designRows";
import { EMPTY_FORM, formFromProduct, formProblems, payloadFromForm, type Form } from "./productForm";

const STATUS_HELP: Record<ProductStatus, string> = {
  draft: "ยังไม่แสดงบนหน้าร้าน ใช้ระหว่างเตรียมข้อมูล",
  active: "แสดงบนหน้าร้าน ลูกค้าสั่งซื้อได้",
  archived: "ซ่อนจากหน้าร้าน แต่ออเดอร์เก่ายังอยู่ครบ",
};

export function ProductEditor({ productId }: { productId?: number }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = productId === undefined;

  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
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
    adminFetch<{ categories: StoreCategory[] }>("categories")
      .then((r) => setCategories(r.categories))
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

  // Functional so an upload finishing mid-edit applies to the current rows, not a stale render's.
  const updateDesignRows: DesignRowsUpdate = (update) => {
    setForm((f) => ({ ...f, designRows: update(f.designRows) }));
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
    const ok = await confirm({
      title: `ลบ "${form.name}"?`,
      message: "ถ้าเคยมีคนสั่งแล้ว ระบบจะเปลี่ยนเป็น \"ปิดการขาย\" แทนการลบ",
      confirmLabel: "ลบสินค้า",
      tone: "danger",
    });
    if (!ok) return;
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
          <Field label="ชื่อสินค้า (ไทย) *">
            <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น เสื้อฮู้ด SU 2026" />
          </Field>
          <Field label="ชื่อสินค้า (อังกฤษ)" hint="ไม่บังคับ · ถ้าเว้นว่าง หน้าร้านภาษาอังกฤษจะแสดงชื่อไทยแทน">
            <input className={inputClass} value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} placeholder="e.g. SU Hoodie 2026" />
          </Field>
          <Field label="หมวด">
            <select
              className={inputClass}
              value={form.categoryId ?? ""}
              onChange={(e) => set("categoryId", e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">ไม่มีหมวด</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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

      <OptionsStep
        saved={!isNew}
        resetKey={product?.updatedAt ?? "new"}
        optionKind={form.optionKind}
        onKindChange={(kind) => {
          set("optionKind", kind);
          if (kind === "designs" && form.designRows.length === 0) set("designRows", [newDesignRow()]);
        }}
        rows={form.rows}
        onRowsChange={(rows) => set("rows", rows)}
        designRows={form.designRows}
        designPrice={form.designPrice}
        onDesignRowsChange={updateDesignRows}
        onDesignPriceChange={(price) => set("designPrice", price)}
      />

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
