"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Badge, Button, Card, Field, inputClass, PRODUCT_STATUS_LABEL, useToast } from "@/components/admin/ui";
import type { ProductStatus, StoreMeta, StoreProduct } from "@/types/store";

type Row = { id?: number; size: string; color: string; price: string; stock: string; active: boolean };

const STATUS_HELP: Record<ProductStatus, string> = {
  draft: "ยังไม่แสดงบนหน้าร้าน ใช้ระหว่างเตรียมข้อมูล",
  active: "แสดงบนหน้าร้าน ลูกค้าสั่งซื้อได้",
  archived: "ซ่อนจากหน้าร้าน แต่ออเดอร์เก่ายังอยู่ครบ",
};

function splitList(text: string) {
  return Array.from(new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)));
}

function rowLabel(r: Pick<Row, "size" | "color">) {
  return [r.size, r.color].filter(Boolean).join(" / ") || "แบบเดียว (ไม่มีตัวเลือก)";
}

function rowsFromProduct(p: StoreProduct): Row[] {
  return p.variants
    .filter((v) => v.active)
    .map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color,
      price: String(v.price),
      stock: v.stock === null ? "" : String(v.stock),
      active: true,
    }));
}

export function ProductEditor({ productId }: { productId?: number }) {
  const router = useRouter();
  const toast = useToast();
  const isNew = productId === undefined;

  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [sizesText, setSizesText] = useState("");
  const [colorsText, setColorsText] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [rows, setRows] = useState<Row[]>([{ size: "", color: "", price: "", stock: "", active: true }]);
  const [buyerFields, setBuyerFields] = useState<string[]>([]);
  const [status, setStatus] = useState<ProductStatus>("draft");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function load(p: StoreProduct) {
    setProduct(p);
    setName(p.name);
    setSlug(p.slug);
    setDescription(p.description);
    setImages(p.images);
    const r = rowsFromProduct(p);
    setRows(r.length ? r : [{ size: "", color: "", price: "", stock: "", active: true }]);
    setSizesText(Array.from(new Set(r.map((x) => x.size).filter(Boolean))).join(", "));
    setColorsText(Array.from(new Set(r.map((x) => x.color).filter(Boolean))).join(", "));
    setBuyerFields(p.buyerFields);
    setStatus(p.status);
    setDirty(false);
  }

  useEffect(() => {
    adminFetch<StoreMeta>("meta").then(setMeta).catch(() => {});
    if (!isNew) {
      adminFetch<StoreProduct>(`products/${productId}`)
        .then((p) => {
          load(p);
          setLoaded(true);
        })
        .catch((e: Error) => toast(e.message, "error"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  function buildTable() {
    const sizes = splitList(sizesText);
    const colors = splitList(colorsText);
    const combos = (sizes.length ? sizes : [""]).flatMap((size) =>
      (colors.length ? colors : [""]).map((color) => ({ size, color }))
    );
    const next = combos.map(
      (c) =>
        rows.find((r) => r.size === c.size && r.color === c.color) ?? {
          ...c,
          price: defaultPrice || rows[0]?.price || "",
          stock: "",
          active: true,
        }
    );
    const dropped = rows.filter((r) => !next.includes(r) && (r.id !== undefined || r.price));
    if (dropped.length && !window.confirm(`ตัวเลือกเหล่านี้จะถูกลบออก: ${dropped.map(rowLabel).join(", ")}\nต้องการทำต่อไหม?`)) {
      return;
    }
    setRows(next);
    setDirty(true);
  }

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!name.trim()) list.push("ยังไม่ได้ใส่ชื่อสินค้า");
    rows.forEach((r) => {
      if (!/^\d+$/.test(r.price)) list.push(`ราคาของ "${rowLabel(r)}" ต้องเป็นตัวเลขจำนวนเต็ม`);
      if (r.stock !== "" && !/^\d+$/.test(r.stock)) list.push(`สต็อกของ "${rowLabel(r)}" ต้องเป็นตัวเลข หรือเว้นว่าง`);
    });
    if (status === "active" && rows.length === 0) list.push("ต้องมีตัวเลือกอย่างน้อย 1 แบบก่อนเปิดขาย");
    return list;
  }, [name, rows, status]);

  async function save() {
    if (problems.length) {
      toast(problems[0], "error");
      return;
    }
    setSaving(true);
    const payload = {
      name,
      description,
      buyerFields,
      status,
      variants: rows.map((r) => ({
        id: r.id,
        size: r.size,
        color: r.color,
        price: Number(r.price),
        stock: r.stock === "" ? null : Number(r.stock),
        active: true,
      })),
      ...(isNew && slug.trim() ? { slug } : {}),
    };
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

  async function uploadImages(files: FileList | null) {
    if (!files?.length || !productId) return;
    setUploading(true);
    try {
      let latest: StoreProduct | null = null;
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("image", file);
        latest = await adminFetch<StoreProduct>(`products/${productId}/images`, { method: "POST", body: form });
      }
      if (latest) setImages(latest.images);
      toast("อัปโหลดรูปแล้ว");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveImages(next: string[]) {
    try {
      const saved = await adminFetch<StoreProduct>(`products/${productId}`, { method: "PUT", json: { images: next } });
      setImages(saved.images);
      toast("บันทึกรูปแล้ว");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function remove() {
    if (!window.confirm(`ลบ "${name}" ใช่ไหม?\n(ถ้าเคยมีคนสั่งแล้ว ระบบจะเปลี่ยนเป็น "ปิดการขาย" แทนการลบ)`)) return;
    try {
      const result = await adminFetch<{ deleted: boolean; archived: boolean }>(`products/${productId}`, { method: "DELETE" });
      toast(result.deleted ? "ลบสินค้าแล้ว" : "มีออเดอร์อยู่แล้ว จึงเปลี่ยนเป็นปิดการขายแทน");
      setDirty(false);
      router.push("/admin/products");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!loaded) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  const optionalFields = meta?.buyerFields.filter((f) => !f.alwaysRequired) ?? [];
  const requiredFields = meta?.buyerFields.filter((f) => f.alwaysRequired) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/products" className="text-sm text-zinc-500 hover:underline">
          ← สินค้าทั้งหมด
        </Link>
        <h1 className="text-2xl font-bold">{isNew ? "เพิ่มสินค้าใหม่" : name || "แก้ไขสินค้า"}</h1>
        {product && <Badge kind="product" status={product.status} />}
      </div>

      <Card step={1} title="ข้อมูลสินค้า" hint="ชื่อและรายละเอียดที่ลูกค้าจะเห็นบนหน้าร้าน">
        <div className="space-y-4">
          <Field label="ชื่อสินค้า *">
            <input className={inputClass} value={name} onChange={(e) => touch(setName)(e.target.value)} placeholder="เช่น เสื้อฮู้ด SU 2026" />
          </Field>
          {isNew ? (
            <Field
              label="ชื่อในลิงก์ (ไม่บังคับ)"
              hint="ภาษาอังกฤษ ตัวเลข และขีด เช่น su-hoodie-2026 · ถ้าเว้นว่าง ระบบสร้างจากชื่อสินค้าให้ · ตั้งแล้วเปลี่ยนไม่ได้"
            >
              <input className={inputClass} value={slug} onChange={(e) => touch(setSlug)(e.target.value)} placeholder="su-hoodie-2026" />
            </Field>
          ) : (
            <p className="text-xs text-zinc-500">
              ลิงก์สินค้า: <code className="rounded bg-zinc-100 px-1.5 py-0.5">/products/{slug}</code>
            </p>
          )}
          <Field label="รายละเอียด" hint="เนื้อผ้า วิธีวัดไซซ์ วัน-เวลารับของ ฯลฯ">
            <textarea
              className={`${inputClass} min-h-28`}
              value={description}
              onChange={(e) => touch(setDescription)(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card step={2} title="รูปภาพ" hint="รูปแรกจะเป็นรูปหน้าปก · รูปบันทึกทันทีที่อัปโหลด/ลบ">
        {isNew ? (
          <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600">กด &quot;บันทึก&quot; ด้านล่างก่อน แล้วจึงเพิ่มรูปได้</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {images.map((src, i) => (
              <div key={src} className="w-36 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="aspect-square w-full object-cover" />
                <div className="flex text-xs">
                  {i === 0 ? (
                    <span className="flex-1 bg-zinc-900 py-1.5 text-center font-semibold text-white">รูปหน้าปก</span>
                  ) : (
                    <button
                      type="button"
                      className="flex-1 py-1.5 hover:bg-zinc-100"
                      onClick={() => saveImages([src, ...images.filter((x) => x !== src)])}
                    >
                      ตั้งเป็นปก
                    </button>
                  )}
                  <button
                    type="button"
                    className="px-3 py-1.5 text-red-600 hover:bg-red-50"
                    onClick={() => window.confirm("ลบรูปนี้?") && saveImages(images.filter((x) => x !== src))}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              disabled={uploading || images.length >= 10}
              onClick={() => fileInput.current?.click()}
              className="flex h-36 w-36 flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-zinc-500 disabled:opacity-50"
            >
              <span className="text-2xl">＋</span>
              {uploading ? "กำลังอัปโหลด..." : "เพิ่มรูป"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(e) => uploadImages(e.target.files)}
            />
          </div>
        )}
      </Card>

      <Card
        step={3}
        title="ตัวเลือก ราคา และสต็อก"
        hint="ถ้าสินค้ามีแบบเดียว ไม่ต้องกรอกไซซ์/สี ใส่แค่ราคาในตารางได้เลย"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="ไซซ์" hint="คั่นด้วยจุลภาค เช่น S, M, L, XL">
            <input className={inputClass} value={sizesText} onChange={(e) => setSizesText(e.target.value)} placeholder="S, M, L, XL" />
          </Field>
          <Field label="สี / แบบ" hint="คั่นด้วยจุลภาค เช่น ดำ, ขาว">
            <input className={inputClass} value={colorsText} onChange={(e) => setColorsText(e.target.value)} placeholder="ดำ, ขาว" />
          </Field>
          <Field label="ราคาเริ่มต้น (บาท)" hint="ใช้กับตัวเลือกที่เพิ่มใหม่">
            <input className={inputClass} inputMode="numeric" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} placeholder="350" />
          </Field>
        </div>
        <Button variant="secondary" className="mt-4" onClick={buildTable}>
          สร้าง/อัปเดตตารางตัวเลือก ↓
        </Button>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-2 pr-3 font-semibold">ตัวเลือก</th>
                <th className="py-2 pr-3 font-semibold">ราคา (บาท) *</th>
                <th className="py-2 pr-3 font-semibold">สต็อก</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.size}|${r.color}|${i}`} className="border-b border-zinc-100">
                  <td className="py-2 pr-3 font-medium">{rowLabel(r)}</td>
                  <td className="py-2 pr-3">
                    <input className={`${inputClass} w-28`} inputMode="numeric" value={r.price} onChange={(e) => updateRow(i, { price: e.target.value.trim() })} />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className={`${inputClass} w-28`}
                      inputMode="numeric"
                      value={r.stock}
                      placeholder="ไม่จำกัด"
                      onChange={(e) => updateRow(i, { stock: e.target.value.trim() })}
                    />
                  </td>
                  <td className="py-2 text-right">
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setRows((list) => list.filter((_, idx) => idx !== i));
                          setDirty(true);
                        }}
                      >
                        ลบ
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-zinc-500">
            สต็อกเว้นว่าง = ขายได้ไม่จำกัด · ใส่ตัวเลข = ระบบตัดสต็อกเองเมื่อมีคนสั่ง และปิดรับเมื่อหมด · ยกเลิกออเดอร์แล้วสต็อกคืนอัตโนมัติ
          </p>
        </div>
      </Card>

      <Card step={4} title="ข้อมูลที่ต้องการจากผู้ซื้อ" hint="ผู้ซื้อต้องกรอกช่องที่เลือกก่อนสั่งซื้อ">
        <p className="mb-3 text-sm text-zinc-600">
          บังคับทุกออเดอร์อยู่แล้ว: {requiredFields.map((f) => f.label).join(", ")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {optionalFields.map((f) => (
            <label key={f.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 hover:bg-zinc-50">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={buyerFields.includes(f.key)}
                onChange={(e) =>
                  touch(setBuyerFields)(
                    e.target.checked ? [...buyerFields, f.key] : buyerFields.filter((k) => k !== f.key)
                  )
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
              className={`cursor-pointer rounded-xl border px-4 py-3 ${status === s ? "border-zinc-900 ring-2 ring-zinc-200" : "border-zinc-200 hover:bg-zinc-50"}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <input type="radio" name="status" checked={status === s} onChange={() => touch(setStatus)(s)} />
                {PRODUCT_STATUS_LABEL[s]}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">{STATUS_HELP[s]}</span>
            </label>
          ))}
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
