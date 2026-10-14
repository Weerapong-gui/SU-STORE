"use client";

import { useEffect, useState } from "react";
import { Button, Field, inputClass } from "@/components/admin/ui";
import { SCHOOL_OPTIONS } from "@/lib/checkoutOptions";
import type { ReceiptSnapshot } from "@/types/store";

export type ReceiptCustomer = ReceiptSnapshot["customer"];

const CONTROL = "min-h-11";
const OTHER_SCHOOL = "__other__";

type Props = {
  initial: ReceiptCustomer;
  busy: boolean;
  onSubmit: (customer: ReceiptCustomer) => void;
  onClose: () => void;
};

// Staff confirm what is printed on the receipt; these values go into the receipt snapshot only,
// never back to the order.
export function IssueReceiptDialog({ initial, busy, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initial.name);
  const [studentCode, setStudentCode] = useState(initial.studentCode);
  const [school, setSchool] = useState(initial.school);
  const [typingSchool, setTypingSchool] = useState(Boolean(initial.school) && !(SCHOOL_OPTIONS as readonly string[]).includes(initial.school));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const incomplete = !studentCode.trim() || !school.trim();
  const selectValue = typingSchool ? OTHER_SCHOOL : school;

  return (
    <div
      className="backdrop-in fixed inset-0 z-[100] flex items-end justify-center bg-zinc-950/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="ออกใบเสร็จ" className="dialog-in w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-zinc-900/5">
        <h2 className="text-base font-bold text-zinc-900">ออกใบเสร็จ</h2>
        <p className="text-sm text-zinc-500">ตรวจข้อมูลที่จะพิมพ์บนใบเสร็จ แก้ไขได้ (ไม่กระทบข้อมูลออเดอร์)</p>
        <Field label="ชื่อผู้ซื้อ">
          <input className={`${inputClass} ${CONTROL}`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="รหัสนักศึกษา">
          <input className={`${inputClass} ${CONTROL}`} value={studentCode} onChange={(e) => setStudentCode(e.target.value)} />
        </Field>
        <Field label="สำนักวิชา">
          <select
            className={`${inputClass} ${CONTROL}`}
            value={selectValue}
            onChange={(e) => {
              if (e.target.value === OTHER_SCHOOL) {
                setTypingSchool(true);
                setSchool("");
              } else {
                setTypingSchool(false);
                setSchool(e.target.value);
              }
            }}
          >
            <option value="">- ไม่ระบุ -</option>
            {SCHOOL_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={OTHER_SCHOOL}>อื่นๆ (พิมพ์เอง)</option>
          </select>
          {typingSchool && (
            <input
              aria-label="สำนักวิชา (พิมพ์เอง)"
              className={`${inputClass} ${CONTROL} mt-2`}
              value={school}
              onChange={(e) => setSchool(e.target.value)}
            />
          )}
        </Field>
        {incomplete && (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ช่องว่างอาจทำให้ใช้ใบเสร็จเบิกเงินไม่ได้
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className={CONTROL} onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            className={CONTROL}
            disabled={busy}
            onClick={() => onSubmit({ name: name.trim(), studentCode: studentCode.trim(), school: school.trim() })}
          >
            ออกใบเสร็จและพิมพ์
          </Button>
        </div>
      </div>
    </div>
  );
}
