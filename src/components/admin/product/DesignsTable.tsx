"use client";

import { useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Button, inputClass, useToast } from "@/components/admin/ui";
import { cleanDesignCode, newDesignRow, type DesignRow, type DesignRowsUpdate } from "./designRows";

const DESKTOP_GRID = "md:grid-cols-[3.25rem_1fr_1fr_7rem_7rem_auto] md:items-center";
const fieldLabel = "block text-xs font-semibold text-zinc-600 md:sr-only";
const smallButton = "min-h-11 min-w-11 rounded-xl px-3 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-30";

// Editable list of designs: stacked cards on phones, one table-like row per design from md up.
export function DesignsTable({ rows, onChange }: { rows: DesignRow[]; onChange: DesignRowsUpdate }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef("");
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const update = (key: string, patch: Partial<DesignRow>) => onChange((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (key: string, by: -1 | 1) =>
    onChange((prev) => {
      const index = prev.findIndex((r) => r.key === key);
      if (index < 0 || !prev[index + by]) return prev;
      const next = [...prev];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  const remove = (key: string) => onChange((prev) => prev.filter((r) => r.key !== key));

  function pickImage(key: string) {
    uploadTarget.current = key;
    fileInput.current?.click();
  }

  async function upload(file: File | undefined) {
    const key = uploadTarget.current;
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setUploadingKey(key);
    try {
      const form = new FormData();
      form.append("image", file);
      const { url } = await adminFetch<{ url: string }>("images", { method: "POST", body: form });
      update(key, { image: url });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploadingKey(null);
    }
  }

  return (
    <div>
      <div className={`hidden gap-3 border-b border-zinc-200 pb-2 text-xs font-semibold text-zinc-500 md:grid ${DESKTOP_GRID}`}>
        <span>รูป</span>
        <span>ชื่อลาย (ไทย) *</span>
        <span>ชื่อลาย (อังกฤษ)</span>
        <span>ตัวย่อ *</span>
        <span>สต็อก</span>
        <span />
      </div>

      <div className="space-y-3 md:space-y-0">
        {rows.map((r, i) => {
          const mover = (cls: string) => (
            <div className={`flex ${cls}`}>
              <button type="button" aria-label="เลื่อนขึ้น" disabled={i === 0} className={smallButton} onClick={() => move(r.key, -1)}>
                ↑
              </button>
              <button type="button" aria-label="เลื่อนลง" disabled={i === rows.length - 1} className={smallButton} onClick={() => move(r.key, 1)}>
                ↓
              </button>
            </div>
          );
          return (
            <div key={r.key} className={`grid gap-3 rounded-xl border border-zinc-200 p-3 md:rounded-none md:border-0 md:border-b md:border-zinc-100 md:px-0 ${DESKTOP_GRID}`}>
              <div className="flex items-center gap-3 md:contents">
                <button
                  type="button"
                  aria-label={r.image ? `เปลี่ยนรูป ${r.designCode}` : "อัปโหลดรูป"}
                  disabled={uploadingKey === r.key}
                  onClick={() => pickImage(r.key)}
                  className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-300 text-lg text-zinc-500 hover:border-zinc-500 md:h-11 md:w-11"
                >
                  {uploadingKey === r.key ? (
                    <span className="text-xs">...</span>
                  ) : r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    "+"
                  )}
                </button>
                <div className="min-w-0 flex-1 md:hidden">
                  <p className="text-sm font-semibold">ลายที่ {i + 1}</p>
                  <p className="text-xs text-zinc-500">แตะรูปเพื่อเปลี่ยน</p>
                </div>
                {mover("md:hidden")}
              </div>
              <label className="block">
                <span className={fieldLabel}>ชื่อลาย (ไทย) *</span>
                <input className={inputClass} aria-label="ชื่อลาย (ไทย)" value={r.designName} onChange={(e) => update(r.key, { designName: e.target.value })} />
              </label>
              <label className="block">
                <span className={fieldLabel}>ชื่อลาย (อังกฤษ)</span>
                <input className={inputClass} aria-label="ชื่อลาย (อังกฤษ)" value={r.designNameEn} onChange={(e) => update(r.key, { designNameEn: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3 md:contents">
                <label className="block">
                  <span className={fieldLabel}>ตัวย่อ *</span>
                  <input
                    className={`${inputClass} uppercase`}
                    aria-label="ตัวย่อ"
                    value={r.designCode}
                    onChange={(e) => update(r.key, { designCode: cleanDesignCode(e.target.value) })}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel}>สต็อก</span>
                  <input
                    className={inputClass}
                    aria-label="สต็อก"
                    inputMode="numeric"
                    placeholder="ไม่จำกัด"
                    value={r.stock}
                    onChange={(e) => update(r.key, { stock: e.target.value.trim() })}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {mover("hidden md:flex")}
                {r.image && (
                  <button type="button" className={`${smallButton} text-zinc-500`} onClick={() => update(r.key, { image: "" })}>
                    ลบรูป
                  </button>
                )}
                <button
                  type="button"
                  className={`${smallButton} text-red-600 hover:bg-red-50`}
                  onClick={() => remove(r.key)}
                >
                  <span className="md:hidden">ลบลายนี้</span>
                  <span className="hidden md:inline">ลบ</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" className="min-h-11" onClick={() => onChange((prev) => [...prev, newDesignRow()])}>
          + เพิ่มลาย
        </Button>
        <span className="text-xs text-zinc-500">{rows.length} ลาย · ใช้ปุ่มลูกศรเพื่อเรียงลำดับที่ลูกค้าเห็น</span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        ตัวย่อใช้ค้นหาและแสดงบนการ์ด ใช้ได้เฉพาะ A–Z, 0–9 และ - ระบบเปลี่ยนเป็นตัวพิมพ์ใหญ่ให้ · สต็อกเว้นว่าง = ขายได้ไม่จำกัด
      </p>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
