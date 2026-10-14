"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Button, Field, inputClass, useToast } from "@/components/admin/ui";
import type { StoreCategory } from "@/types/store";
import { CoverUpload } from "./CoverUpload";

type Form = {
  name: string;
  nameEn: string;
  slug: string;
  tagline: string;
  taglineEn: string;
  coverImage: string;
  visible: boolean;
};

function formFrom(c: StoreCategory | undefined): Form {
  return {
    name: c?.name ?? "",
    nameEn: c?.nameEn ?? "",
    slug: "",
    tagline: c?.tagline ?? "",
    taglineEn: c?.taglineEn ?? "",
    coverImage: c?.coverImage ?? "",
    visible: c?.visible ?? true,
  };
}

// Create (no `category`) or edit one category. The slug is only sent on create; the server keeps it fixed.
export function CategoryEditor({ category, onSaved, onDeleted }: {
  category?: StoreCategory;
  onSaved: (category: StoreCategory) => void;
  onDeleted: (id: number) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<Form>(() => formFrom(category));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.name.trim()) return toast("กรุณากรอกชื่อหมวด (ไทย)", "error");
    setSaving(true);
    try {
      const { slug, ...fields } = form;
      const body = category ? fields : { ...fields, ...(slug.trim() ? { slug } : {}) };
      const result = await adminFetch<StoreCategory>(category ? `categories/${category.id}` : "categories", {
        method: category ? "PUT" : "POST",
        json: body,
      });
      toast("บันทึกแล้ว");
      onSaved(result);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!category) return;
    const ok = await confirm({
      title: `ลบหมวด "${category.name}"?`,
      message: `สินค้า ${category.productCount} ชิ้นในหมวดนี้จะกลายเป็น 'ไม่มีหมวด' (สินค้าไม่ถูกลบ)`,
      confirmLabel: "ลบหมวด",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await adminFetch(`categories/${category.id}`, { method: "DELETE" });
      toast("ลบหมวดแล้ว");
      onDeleted(category.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <section className="min-w-0 flex-[1_1_360px] rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-[17px] font-bold">{category ? `แก้หมวด: ${category.name}` : "เพิ่มหมวดใหม่"}</h2>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อ (ไทย) *">
            <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="ชื่อ (อังกฤษ)">
            <input className={inputClass} value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
          </Field>
        </div>
        {!category && (
          <Field
            label="ชื่อในลิงก์ (ไม่บังคับ)"
            hint="ภาษาอังกฤษ ตัวเลข และขีด เช่น keychain · ถ้าเว้นว่าง ระบบสร้างจากชื่อหมวดให้ · ตั้งแล้วเปลี่ยนไม่ได้"
          >
            <input className={inputClass} value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="keychain" />
          </Field>
        )}
        <Field label="ข้อความบนปก (ไทย)">
          <input className={inputClass} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
        </Field>
        <Field label="ข้อความบนปก (อังกฤษ)">
          <input className={inputClass} value={form.taglineEn} onChange={(e) => set("taglineEn", e.target.value)} />
        </Field>
        <CoverUpload value={form.coverImage} onChange={(url) => set("coverImage", url)} />
        <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold text-zinc-800">
          <input type="checkbox" className="h-[18px] w-[18px]" checked={form.visible} onChange={(e) => set("visible", e.target.checked)} />
          แสดงบนหน้าร้าน
        </label>
        {category && (
          <p className="text-[13px] text-zinc-500">
            ลิงก์: <code className="rounded bg-zinc-100 px-1.5 py-0.5">/products/c/{category.slug}</code> (ตั้งแล้วเปลี่ยนไม่ได้)
          </p>
        )}
      </div>
      <div className="mt-5 flex items-center justify-between gap-2 border-t border-zinc-100 pt-4">
        {category ? (
          <Button variant="ghost" className="min-h-11 text-red-600 hover:bg-red-50" onClick={remove}>
            ลบหมวด
          </Button>
        ) : (
          <span />
        )}
        <Button className="min-h-11" disabled={saving} onClick={save}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </Button>
      </div>
    </section>
  );
}
