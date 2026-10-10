"use client";

import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/admin/ui";
import { buildRows, droppedRows, rowLabel, splitList, uniqueValues, type VariantRow } from "./variants";

// Step 3 of the product editor: sizes × colours → a table of price and stock per variant.
export function VariantsCard({ rows, onChange }: { rows: VariantRow[]; onChange: (rows: VariantRow[]) => void }) {
  const [sizesText, setSizesText] = useState(() => uniqueValues(rows, "size").join(", "));
  const [colorsText, setColorsText] = useState(() => uniqueValues(rows, "color").join(", "));
  const [defaultPrice, setDefaultPrice] = useState("");

  function rebuild() {
    const next = buildRows(splitList(sizesText), splitList(colorsText), defaultPrice, rows);
    const dropped = droppedRows(rows, next);
    if (dropped.length && !window.confirm(`ตัวเลือกเหล่านี้จะถูกลบออก: ${dropped.map(rowLabel).join(", ")}\nต้องการทำต่อไหม?`)) {
      return;
    }
    onChange(next);
  }

  const updateRow = (index: number, patch: Partial<VariantRow>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <Card step={3} title="ตัวเลือก ราคา และสต็อก" hint="ถ้าสินค้ามีแบบเดียว ไม่ต้องกรอกไซซ์/สี ใส่แค่ราคาในตารางได้เลย">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="ไซซ์" hint="คั่นด้วยจุลภาค เช่น S, M, L, XL">
          <input className={inputClass} value={sizesText} onChange={(e) => setSizesText(e.target.value)} placeholder="S, M, L, XL" />
        </Field>
        <Field label="สี / แบบ" hint="คั่นด้วยจุลภาค เช่น ดำ, ขาว">
          <input className={inputClass} value={colorsText} onChange={(e) => setColorsText(e.target.value)} placeholder="ดำ, ขาว" />
        </Field>
        <Field label="ราคาเริ่มต้น (บาท)" hint="ใช้กับตัวเลือกที่เพิ่มใหม่">
          <input className={inputClass} inputMode="numeric" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} placeholder="350" />
        </Field>
      </div>
      <Button variant="secondary" className="mt-4" onClick={rebuild}>
        สร้าง/อัปเดตตารางตัวเลือก ↓
      </Button>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="py-2 pr-3 font-semibold">ตัวเลือก</th>
              <th className="py-2 pr-3 font-semibold">ราคา (บาท) *</th>
              <th className="py-2 pr-3 font-semibold">สต็อก</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.size}|${r.color}|${i}`} className="border-b border-zinc-100">
                <td className="py-2 pr-3 font-medium">{rowLabel(r)}</td>
                <td className="py-2 pr-3">
                  <input className={`${inputClass} w-28`} inputMode="numeric" value={r.price} onChange={(e) => updateRow(i, { price: e.target.value.trim() })} />
                </td>
                <td className="py-2 pr-3">
                  <input
                    className={`${inputClass} w-28`}
                    inputMode="numeric"
                    value={r.stock}
                    placeholder="ไม่จำกัด"
                    onChange={(e) => updateRow(i, { stock: e.target.value.trim() })}
                  />
                </td>
                <td className="py-2 text-right">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                    >
                      ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-zinc-500">
          สต็อกเว้นว่าง = ขายได้ไม่จำกัด · ใส่ตัวเลข = ระบบตัดสต็อกเองเมื่อมีคนสั่ง และปิดรับเมื่อหมด · ยกเลิกออเดอร์แล้วสต็อกคืนอัตโนมัติ
        </p>
      </div>
    </Card>
  );
}
