"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminFetch, formatBaht } from "@/lib/adminApi";
import { Badge, EmptyState, useToast } from "@/components/admin/ui";
import type { StoreProduct } from "@/types/store";

function priceText(p: StoreProduct) {
  if (p.minPrice === null) return "ยังไม่ได้ตั้งราคา";
  return p.minPrice === p.maxPrice ? formatBaht(p.minPrice) : `${formatBaht(p.minPrice)} – ${formatBaht(p.maxPrice)}`;
}

function stockText(p: StoreProduct) {
  const active = p.variants.filter((v) => v.active);
  if (active.length === 0) return "ยังไม่มีตัวเลือก";
  if (active.some((v) => v.stock === null)) return "ไม่จำกัดจำนวน";
  const left = active.reduce((sum, v) => sum + (v.stock ?? 0), 0);
  return left > 0 ? `เหลือ ${left.toLocaleString("th-TH")} ชิ้น` : "สินค้าหมด";
}

export default function ProductsPage() {
  const toast = useToast();
  const [products, setProducts] = useState<StoreProduct[] | null>(null);

  useEffect(() => {
    adminFetch<{ products: StoreProduct[] }>("products")
      .then((data) => setProducts(data.products))
      .catch((error: Error) => {
        toast(error.message, "error");
        setProducts([]);
      });
  }, [toast]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">สินค้า</h1>
          <p className="text-sm text-zinc-500">สินค้าที่ &quot;เปิดขาย&quot; จะแสดงบนหน้าร้านทันที</p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-700"
        >
          ＋ เพิ่มสินค้า
        </Link>
      </div>

      {products === null ? (
        <p className="text-sm text-zinc-500">กำลังโหลด...</p>
      ) : products.length === 0 ? (
        <EmptyState title="ยังไม่มีสินค้า">กด &quot;＋ เพิ่มสินค้า&quot; ด้านบนเพื่อเริ่มลงขายชิ้นแรก</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Link
              key={p.id}
              href={`/admin/products/${p.id}`}
              className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:shadow-md"
            >
              <div className="aspect-[4/3] bg-zinc-100">
                {p.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-400">ยังไม่มีรูป</div>
                )}
              </div>
              <div className="space-y-1.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-zinc-900 group-hover:underline">{p.name}</p>
                  <Badge kind="product" status={p.status} />
                </div>
                <p className="text-sm text-zinc-700">{priceText(p)}</p>
                <p className="text-xs text-zinc-500">
                  {p.variants.filter((v) => v.active).length} ตัวเลือก · {stockText(p)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
