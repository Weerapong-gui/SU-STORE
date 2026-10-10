"use client";

import { useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Card, useToast } from "@/components/admin/ui";
import type { StoreProduct } from "@/types/store";

// Mirrors add_product_image() in server/store/db.py, which keeps the first 10.
const MAX_IMAGES = 10;

// Step 2 of the product editor. Unlike the other steps, image changes save immediately.
export function ImagesCard({ productId, images, onChange }: {
  productId: number | undefined;
  images: string[];
  onChange: (images: string[]) => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length || !productId) return;
    setUploading(true);
    try {
      let latest: StoreProduct | null = null;
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("image", file);
        latest = await adminFetch<StoreProduct>(`products/${productId}/images`, { method: "POST", body: form });
      }
      if (latest) onChange(latest.images);
      toast("อัปโหลดรูปแล้ว");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save(next: string[]) {
    try {
      const saved = await adminFetch<StoreProduct>(`products/${productId}`, { method: "PUT", json: { images: next } });
      onChange(saved.images);
      toast("บันทึกรูปแล้ว");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <Card step={2} title="รูปภาพ" hint="รูปแรกจะเป็นรูปหน้าปก · รูปบันทึกทันทีที่อัปโหลด/ลบ">
      {productId === undefined ? (
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
                  <button type="button" className="flex-1 py-1.5 hover:bg-zinc-100" onClick={() => save([src, ...images.filter((x) => x !== src)])}>
                    ตั้งเป็นปก
                  </button>
                )}
                <button
                  type="button"
                  className="px-3 py-1.5 text-red-600 hover:bg-red-50"
                  onClick={() => window.confirm("ลบรูปนี้?") && save(images.filter((x) => x !== src))}
                >
                  ลบ
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={uploading || images.length >= MAX_IMAGES}
            onClick={() => fileInput.current?.click()}
            className="flex h-36 w-36 flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-zinc-500 disabled:opacity-50"
          >
            <span className="text-2xl">＋</span>
            {uploading ? "กำลังอัปโหลด..." : "เพิ่มรูป"}
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
      )}
    </Card>
  );
}
