"use client";

import { useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { useToast } from "@/components/admin/ui";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { MAX_DESIGN_IMAGES, moveImage, removeImage } from "./designRows";

const thumbSize = "h-14 w-14 md:h-11 md:w-11";
const tinyButton = "min-h-8 min-w-8 rounded-lg px-1 text-xs text-zinc-600 hover:bg-zinc-100";

type Props = {
  images: string[];
  designCode: string;
  /** Functional update, so an upload that finishes late appends to the images as they are now. */
  onChange: (update: (images: string[]) => string[]) => void;
};

// A design's gallery: small thumbnails in a row, the first one is the main image customers see first.
export function DesignImagesCell({ images, designCode, onChange }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const { url } = await adminFetch<{ url: string }>("images", { method: "POST", body: form });
      onChange((prev) => (prev.length < MAX_DESIGN_IMAGES ? [...prev, url] : prev));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function remove(index: number) {
    if (!(await confirm({ title: "ลบรูปนี้?", confirmLabel: "ลบรูป", tone: "danger" }))) return;
    onChange((prev) => removeImage(prev, index));
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {images.map((src, i) => (
        <div key={`${src}-${i}`} className="flex flex-col items-center">
          <div className={`relative overflow-hidden rounded-xl border border-zinc-200 ${thumbSize}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`รูปที่ ${i + 1} ของ ${designCode}`} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute inset-x-0 bottom-0 bg-zinc-900/70 text-center text-[10px] leading-4 text-white">รูปหลัก</span>
            )}
          </div>
          <div className="flex">
            {i > 0 && (
              <button type="button" aria-label={`เลื่อนรูปไปซ้าย ${i + 1}`} className={tinyButton} onClick={() => onChange((prev) => moveImage(prev, i, i - 1))}>
                ‹
              </button>
            )}
            <button type="button" aria-label={`ลบรูป ${i + 1}`} className={`${tinyButton} text-red-600 hover:bg-red-50`} onClick={() => remove(i)}>
              ลบ
            </button>
            {i < images.length - 1 && (
              <button type="button" aria-label={`เลื่อนรูปไปขวา ${i + 1}`} className={tinyButton} onClick={() => onChange((prev) => moveImage(prev, i, i + 1))}>
                ›
              </button>
            )}
          </div>
        </div>
      ))}
      {images.length < MAX_DESIGN_IMAGES && (
        <button
          type="button"
          aria-label="เพิ่มรูป"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className={`flex shrink-0 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-lg text-zinc-500 hover:border-zinc-500 ${thumbSize}`}
        >
          {uploading ? <span className="text-xs">...</span> : "+"}
        </button>
      )}
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
