"use client";

import { Card, Field, inputClass } from "@/components/admin/ui";
import { CONTROL } from "./controls";

export function PrefixCard({ prefix, nextNo, onChange }: { prefix: string; nextNo: string; onChange: (prefix: string) => void }) {
  return (
    <Card title="เลขที่ใบเสร็จ">
      <Field label="ตัวหน้าเลข" hint="ใช้ได้เฉพาะ A-Z, 0-9 และขีด (-) ไม่เกิน 20 ตัว">
        <input className={`${inputClass} ${CONTROL}`} maxLength={20} value={prefix} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <p className="mt-2 text-sm text-zinc-500">
        ใบถัดไป: <b className="text-zinc-900">{nextNo}</b>{" "}
        · นับต่อเนื่อง ไม่ซ้ำ ทุกเครื่องใช้ชุดเดียวกัน
      </p>
    </Card>
  );
}
