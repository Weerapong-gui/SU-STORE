"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { move } from "@/components/admin/home/blocks";
import { IconButton } from "@/components/admin/home/controls";
import type { StoreCategory } from "@/types/store";

function countText(c: StoreCategory) {
  return c.productCount === 0 ? "ยังไม่มีสินค้า" : `${c.productCount} สินค้า`;
}

// Ordered category rows: drag the grip (mouse) or use the arrows (touch) to reorder.
export function CategoryList({ categories, selectedId, onReorder }: {
  categories: StoreCategory[];
  selectedId: number | null;
  onReorder: (next: StoreCategory[]) => void;
}) {
  const dragFrom = useRef<number | null>(null);

  function drop(to: number) {
    if (dragFrom.current !== null) onReorder(move(categories, dragFrom.current, to));
    dragFrom.current = null;
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {categories.map((c, i) => (
        <div
          key={c.id}
          draggable
          onDragStart={() => (dragFrom.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(i)}
          className={`flex items-center gap-3 border-b border-zinc-100 p-3 first:rounded-t-2xl last:rounded-b-2xl last:border-b-0 ${
            c.id === selectedId ? "bg-zinc-100" : ""
          }`}
        >
          <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-zinc-400" aria-hidden />
          <Link href={`/admin/categories/${c.id}`} className={`flex min-w-0 flex-1 items-center gap-3 ${c.visible ? "" : "opacity-60"}`}>
            {c.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.coverImage} alt="" draggable={false} className="h-12 w-[72px] shrink-0 rounded-xl bg-zinc-100 object-cover" />
            ) : (
              <span className="flex h-12 w-[72px] shrink-0 items-center justify-center rounded-xl bg-zinc-200 text-xs text-zinc-400">ไม่มีรูป</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-zinc-900">
                {c.name}
                {c.nameEn && <span className="font-normal text-zinc-400"> · {c.nameEn}</span>}
              </span>
              <span className="block truncate text-[13px] text-zinc-500">
                /products/c/{c.slug} · {countText(c)}
              </span>
            </span>
          </Link>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              c.visible ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"
            }`}
          >
            {c.visible ? "แสดง" : "ซ่อน"}
          </span>
          <div className="flex shrink-0">
            <IconButton label="เลื่อนขึ้น" icon={ArrowUp} disabled={i === 0} onClick={() => onReorder(move(categories, i, i - 1))} />
            <IconButton label="เลื่อนลง" icon={ArrowDown} disabled={i === categories.length - 1} onClick={() => onReorder(move(categories, i, i + 1))} />
          </div>
        </div>
      ))}
    </div>
  );
}
