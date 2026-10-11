"use client";

import { Card } from "@/components/admin/ui";
import { radiusVars } from "@/lib/radius";
import { Segmented } from "./controls";

const CORNER_PRESETS = [
  { value: 0, name: "เหลี่ยม" },
  { value: 30, name: "มนเล็กน้อย" },
  { value: 60, name: "มนปานกลาง" },
  { value: 100, name: "มนเต็มที่ (เดิม)" },
];
// Corner of the preset swatch at 100%, matching the storefront's product cards (rounded-3xl).
const SWATCH_MAX_RADIUS_PX = 14;

// Presets + slider, shared by the store-wide card and each block's form.
export function CornerControl({ value, onChange }: { value: number; onChange: (radius: number) => void }) {
  return (
    <div>
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
    </div>
  );
}

export function CornerPicker({ value, accent, onChange }: {
  value: number;
  accent: string;
  onChange: (radius: number) => void;
}) {
  return (
    <Card
      title="มุมเริ่มต้นของทั้งร้าน"
      hint="ใช้กับเมนู หน้าสินค้า หน้าสั่งซื้อ และบล็อกที่ตั้งเป็น &quot;ตามค่าร้าน&quot; ปรับรายบล็อกได้ในแต่ละบล็อกด้านบน (หลังร้านไม่เปลี่ยน)"
    >
      <CornerControl value={value} onChange={onChange} />

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

// Per-block override, shown at the bottom of every block's form.
export function BlockCornerField({ value, storeRadius, onChange }: {
  value: number | undefined;
  storeRadius: number;
  onChange: (radius: number | undefined) => void;
}) {
  const custom = value !== undefined;
  return (
    <div className="mt-5 border-t border-zinc-100 pt-4">
      <p className="text-sm font-semibold text-zinc-800">มุมของปุ่มและการ์ดในบล็อกนี้</p>
      <div className="mt-2">
        <Segmented
          value={custom ? "custom" : "store"}
          options={[
            { value: "store", label: `ตามค่าร้าน (${storeRadius}%)` },
            { value: "custom", label: "กำหนดเอง" },
          ]}
          onChange={(mode) => onChange(mode === "custom" ? (value ?? storeRadius) : undefined)}
        />
      </div>
      {custom && (
        <div className="mt-3">
          <CornerControl value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
