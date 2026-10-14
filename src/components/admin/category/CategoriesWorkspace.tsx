"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/adminApi";
import { EmptyState, useToast } from "@/components/admin/ui";
import type { StoreCategory } from "@/types/store";
import { CategoryEditor } from "./CategoryEditor";
import { CategoryList } from "./CategoryList";

// The categories screen: the ordered list with the edit form beside it (stacked on narrow screens).
export function CategoriesWorkspace({ selected }: { selected?: number | "new" }) {
  const router = useRouter();
  const toast = useToast();
  const [categories, setCategories] = useState<StoreCategory[] | null>(null);

  const load = useCallback(
    () =>
      adminFetch<{ categories: StoreCategory[] }>("categories")
        .then((data) => setCategories(data.categories))
        .catch((error: Error) => {
          toast(error.message, "error");
          setCategories((current) => current ?? []);
        }),
    [toast]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function reorder(next: StoreCategory[]) {
    const previous = categories;
    setCategories(next);
    try {
      await adminFetch("categories/order", { method: "PUT", json: { ids: next.map((c) => c.id) } });
    } catch (e) {
      toast((e as Error).message, "error");
      setCategories(previous);
    }
  }

  function saved(category: StoreCategory) {
    setCategories((list) => {
      const rest = list ?? [];
      return rest.some((c) => c.id === category.id) ? rest.map((c) => (c.id === category.id ? category : c)) : [...rest, category];
    });
    if (selected === "new") router.replace(`/admin/categories/${category.id}`);
  }

  function deleted(id: number) {
    setCategories((list) => (list ?? []).filter((c) => c.id !== id));
    router.replace("/admin/categories");
  }

  const current = typeof selected === "number" ? categories?.find((c) => c.id === selected) : undefined;
  const showEditor = selected === "new" || (selected !== undefined && current !== undefined);

  return (
    <div className="flex flex-wrap items-start gap-5">
      <section className="min-w-0 flex-[999_1_560px]">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">หมวดหมู่</h1>
            <p className="text-sm text-zinc-500">ลำดับในรายการนี้คือลำดับที่ลูกค้าเห็นในแถบหมวดบนหน้าร้าน</p>
          </div>
          <Link href="/admin/categories/new" className="inline-flex min-h-11 items-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-700">
            ＋ เพิ่มหมวด
          </Link>
        </div>
        {categories === null ? (
          <p className="text-sm text-zinc-500">กำลังโหลด...</p>
        ) : categories.length === 0 ? (
          <EmptyState title="ยังไม่มีหมวดหมู่">กด &quot;＋ เพิ่มหมวด&quot; ด้านบนเพื่อสร้างหมวดแรก</EmptyState>
        ) : (
          <CategoryList categories={categories} selectedId={current?.id ?? null} onReorder={reorder} />
        )}
        <p className="mx-0.5 mt-3 text-[13px] text-zinc-500">
          หมวดที่ซ่อนจะหายจากแถบหมวดและการ์ดปก แต่สินค้าในหมวดยังขายได้ตามปกติ ถ้าจะหยุดขายให้เปลี่ยนสถานะที่ตัวสินค้า
        </p>
      </section>

      {showEditor && (
        <CategoryEditor key={selected === "new" ? "new" : current!.id} category={current} onSaved={saved} onDeleted={deleted} />
      )}
    </div>
  );
}
