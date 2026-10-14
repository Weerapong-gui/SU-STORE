"use client";

import { useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Button, useToast } from "@/components/admin/ui";

// Cover image picker for a category. The upload only returns a URL; it is saved with the form.
export function CoverUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const { url } = await adminFetch<{ url: string }>("images", { method: "POST", body: form });
      onChange(url);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold text-zinc-800">รูปปก</p>
      <div className="mt-1.5 flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-20 w-[120px] rounded-xl border border-zinc-200 object-cover" />
        ) : (
          <div className="flex h-20 w-[120px] items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 text-xs text-zinc-400">
            ยังไม่มีรูป
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? "กำลังอัปโหลด..." : value ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
          </Button>
          {value && (
            <Button variant="ghost" onClick={() => onChange("")}>
              เอารูปออก
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">แนะนำรูปแนวนอน 3:2 ใช้ทั้งการ์ดปกและไอคอนในแถบหมวด</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
