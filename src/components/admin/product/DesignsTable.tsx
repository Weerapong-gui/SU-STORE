"use client";

import { Button, inputClass } from "@/components/admin/ui";
import { DesignImagesCell } from "./DesignImagesCell";
import { cleanDesignCode, MAX_DESIGN_IMAGES, newDesignRow, type DesignRow, type DesignRowsUpdate } from "./designRows";

const DESKTOP_GRID = "md:grid-cols-[1fr_1fr_7rem_7rem_auto] md:items-center";
const fieldLabel = "block text-xs font-semibold text-zinc-600 md:sr-only";
const smallButton = "min-h-11 min-w-11 rounded-xl px-3 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-30";

// Editable list of designs: stacked cards on phones, one table-like row per design from md up.
export function DesignsTable({ rows, onChange }: { rows: DesignRow[]; onChange: DesignRowsUpdate }) {
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

  const updateImages = (key: string, change: (images: string[]) => string[]) =>
    onChange((prev) => prev.map((r) => (r.key === key ? { ...r, images: change(r.images) } : r)));

  return (
    <div>
      <div className={`hidden gap-3 border-b border-zinc-200 pb-2 text-xs font-semibold text-zinc-500 md:grid ${DESKTOP_GRID}`}>
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
              <div className="flex items-center gap-3 md:hidden">
                <p className="min-w-0 flex-1 text-sm font-semibold">ลายที่ {i + 1}</p>
                {mover("")}
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
                <button
                  type="button"
                  className={`${smallButton} text-red-600 hover:bg-red-50`}
                  onClick={() => remove(r.key)}
                >
                  <span className="md:hidden">ลบลายนี้</span>
                  <span className="hidden md:inline">ลบ</span>
                </button>
              </div>
              <div className="md:col-span-full md:pb-3">
                <span className="mb-1 block text-xs font-semibold text-zinc-600">รูป (รูปแรกคือรูปหลัก)</span>
                <DesignImagesCell images={r.images} designCode={r.designCode} onChange={(change) => updateImages(r.key, change)} />
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
        ตัวย่อใช้ค้นหาและแสดงบนการ์ด ใช้ได้เฉพาะ A–Z, 0–9 และ - ระบบเปลี่ยนเป็นตัวพิมพ์ใหญ่ให้ · สต็อกเว้นว่าง = ขายได้ไม่จำกัด · รูปใส่ได้ลายละไม่เกิน {MAX_DESIGN_IMAGES} รูป เลื่อนด้วย ‹ › รูปแรกคือรูปหลัก
      </p>
    </div>
  );
}
