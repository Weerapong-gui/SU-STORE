"use client";

import { useEffect, useState } from "react";
import { contrastWithWhite } from "@/lib/accent";
import { Card, inputClass } from "@/components/admin/ui";

// Same threshold the server enforces in validate_home() (WCAG AA for normal text).
const MIN_CONTRAST = 4.5;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const ACCENT_PRESETS = [
  { hex: "#0071e3", name: "ฟ้า (เดิม)" },
  { hex: "#1d3a8a", name: "กรมท่า" },
  { hex: "#15803d", name: "เขียว" },
  { hex: "#c62828", name: "แดง" },
  { hex: "#7b1fa2", name: "ม่วง" },
  { hex: "#c2410c", name: "ส้ม" },
  { hex: "#be185d", name: "ชมพู" },
  { hex: "#1d1d1f", name: "ดำ" },
];

const isReadable = (hex: string) => HEX_RE.test(hex) && contrastWithWhite(hex) >= MIN_CONTRAST;

export function AccentPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = HEX_RE.test(text);

  // Only readable colours reach the layout; the input keeps whatever was typed.
  function commit(hex: string) {
    setText(hex);
    if (isReadable(hex)) onChange(hex.toLowerCase());
  }

  const preview = valid ? text : value;
  return (
    <Card title="สีหลักของร้าน" hint="ใช้กับปุ่ม ลิงก์ และแถบประกาศทั้งร้าน (หลังร้านไม่เปลี่ยนสี)">
      <div className="flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            onClick={() => commit(p.hex)}
            className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${
              value === p.hex ? "border-zinc-900 ring-2 ring-zinc-900/10" : "border-zinc-200 hover:border-zinc-400"
            }`}
          >
            <span className="h-6 w-6 rounded-full" style={{ background: p.hex }} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input type="color" value={preview} onChange={(e) => commit(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-zinc-300" aria-label="เลือกสีเอง" />
        <div className="w-32">
          <input className={`${inputClass} font-mono`} value={text} maxLength={7} onChange={(e) => commit(e.target.value.trim())} aria-label="รหัสสี" />
        </div>
        <span className="rounded-full px-5 py-2 text-sm font-semibold text-white" style={{ background: preview }}>
          ตัวอย่างปุ่ม
        </span>
      </div>
      {valid && !isReadable(text) && (
        <p className="mt-2 text-sm font-medium text-red-600">สีนี้อ่อนเกินไป ตัวหนังสือสีขาวบนปุ่มจะอ่านยาก ยังไม่ได้บันทึก ลองเลือกสีที่เข้มขึ้น</p>
      )}
    </Card>
  );
}
