"use client";

import { Card } from "@/components/admin/ui";
import { fontFamily, fontPreviewStylesheet, STORE_FONTS } from "@/lib/fonts";

const SAMPLE = "สวัสดี SU STORE ฿290";

export function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  return (
    <Card title="ฟอนต์ของร้าน" hint="ใช้กับตัวหนังสือทั้งร้าน ทุกฟอนต์รองรับภาษาไทยและอังกฤษ (หลังร้านไม่เปลี่ยน)">
      <link rel="stylesheet" href={fontPreviewStylesheet(SAMPLE)} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {STORE_FONTS.map((font) => (
          <button
            key={font.id}
            type="button"
            onClick={() => onChange(font.id)}
            aria-pressed={value === font.id}
            className={`rounded-xl border px-4 py-3 text-left transition ${
              value === font.id ? "border-zinc-900 ring-2 ring-zinc-900/10" : "border-zinc-200 hover:border-zinc-400"
            }`}
          >
            <span className="block truncate text-lg text-zinc-900" style={{ fontFamily: fontFamily(font) }}>
              {SAMPLE}
            </span>
            <span className="mt-0.5 block text-xs font-medium text-zinc-500">{font.name}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
