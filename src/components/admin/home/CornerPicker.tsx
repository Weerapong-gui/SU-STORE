"use client";

import { Card } from "@/components/admin/ui";
import { radiusVars } from "@/lib/radius";

const CORNER_PRESETS = [
  { value: 0, name: "เหลี่ยม" },
  { value: 30, name: "มนเล็กน้อย" },
  { value: 60, name: "มนปานกลาง" },
  { value: 100, name: "มนเต็มที่ (เดิม)" },
];
// Corner of the preset swatch at 100%, matching the storefront's product cards (rounded-3xl).
const SWATCH_MAX_RADIUS_PX = 14;

export function CornerPicker({ value, accent, onChange }: {
  value: number;
  accent: string;
  onChange: (radius: number) => void;
}) {
  return (
    <Card title="มุมของปุ่มและการ์ด" hint="ปรับความโค้งของมุมทั้งร้าน ตั้งแต่เหลี่ยมจนถึงโค้งมนแบบเดิม (หลังร้านไม่เปลี่ยน)">
      <div className="flex flex-wrap gap-2">
        {CORNER_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            className={`flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-sm ${
              value === p.value ? "border-zinc-900 ring-2 ring-zinc-900/10" : "border-zinc-200 hover:border-zinc-400"
            }`}
          >
            <span
              className="h-6 w-6 border-2 border-l-zinc-800 border-t-zinc-800 border-b-transparent border-r-transparent"
              style={{ borderTopLeftRadius: (p.value / 100) * SWATCH_MAX_RADIUS_PX }}
            />
            {p.name}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full max-w-xs accent-zinc-900"
          aria-label="ความโค้งของมุม"
        />
        <span className="w-12 text-sm font-semibold tabular-nums text-zinc-700">{value}%</span>
      </div>

      {/* Same classes as the storefront, scaled by the same CSS variables. */}
      <div className="mt-5 rounded-xl bg-zinc-50 p-4">
        <div className="flex flex-wrap items-end gap-4" style={radiusVars(value) as React.CSSProperties}>
          <div className="w-36 overflow-hidden rounded-3xl border border-zinc-200 bg-white">
            <div className="m-2 h-20 rounded-2xl bg-zinc-200" />
            <p className="px-3 pb-3 text-xs font-semibold text-zinc-700">ตัวอย่างการ์ดสินค้า</p>
          </div>
          <span className="rounded-full px-6 py-2.5 text-sm font-semibold text-white" style={{ background: accent }}>
            ตัวอย่างปุ่ม
          </span>
          <span className="rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-500">ช่องกรอกข้อมูล</span>
        </div>
      </div>
    </Card>
  );
}
