"use client";

import { Field, inputClass } from "@/components/admin/ui";
import type { HomeBlock, StoreCategory } from "@/types/store";
import { MAX_HOME_CATEGORIES } from "./blocks";

type Props = {
  block: Extract<HomeBlock, { type: "categories" }>;
  onChange: (b: HomeBlock) => void;
  categories: StoreCategory[];
};

export function CategoriesForm({ block, onChange, categories }: Props) {
  // Ids of deleted categories are dropped so they neither count toward the cap nor linger after the next save.
  const existing = new Set(categories.map((c) => c.id));
  const categoryIds = block.categoryIds.filter((id) => existing.has(id));
  const selected = new Set(categoryIds);
  const toggle = (id: number) =>
    onChange({ ...block, categoryIds: selected.has(id) ? categoryIds.filter((x) => x !== id) : [...categoryIds, id] });

  return (
    <div className="space-y-4">
      <Field label="หัวข้อ" hint="เว้นว่าง = ใช้คำว่า เลือกตามหมวด (และ Shop by category ตอนลูกค้าเลือกภาษาอังกฤษ)">
        <input className={inputClass} value={block.title} maxLength={80} placeholder="เลือกตามหมวด" onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <div>
        <p className="text-sm font-semibold text-zinc-800">
          เลือกหมวดหมู่ ({categoryIds.length}/{MAX_HOME_CATEGORIES})
        </p>
        <p className="mb-2 text-xs text-zinc-500">
          ไม่ติ๊กเลย = แสดงทุกหมวดที่เปิดแสดง เรียงตามลำดับในหน้าหมวดหมู่ หมวดที่ซ่อนอยู่จะไม่ขึ้นในหน้าร้าน
        </p>
        {categories.length === 0 ? (
          <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600">ยังไม่มีหมวดหมู่ เพิ่มได้ที่เมนู หมวดหมู่</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => {
              const checked = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${checked ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && categoryIds.length >= MAX_HOME_CATEGORIES}
                    onChange={() => toggle(c.id)}
                    className="h-5 w-5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    {!c.visible && <span className="block text-xs text-amber-700">ซ่อนอยู่</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
