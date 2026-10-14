"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/admin/ui";
import type { StoreReceipt } from "@/types/store";
import { useModalFocus } from "./useModalFocus";

const CONTROL = "min-h-11";

// useConfirm has no input slot, so the required reason lives in a small dialog with the same look.
export function CancelReceiptDialog({ receipt, busy, onSubmit, onClose }: {
  receipt: StoreReceipt;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalFocus(busy, onClose);

  return (
    <div
      className="backdrop-in fixed inset-0 z-[100] flex items-end justify-center bg-zinc-950/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={onBackdropMouseDown}
    >
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label="ยกเลิกใบเสร็จ" className="dialog-in outline-none w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-zinc-900/5">
        <h2 className="text-base font-bold text-zinc-900">ยกเลิกใบเสร็จ {receipt.receiptNo}?</h2>
        <p className="text-sm text-zinc-600">เลขใบเสร็จนี้จะไม่ถูกนำกลับมาใช้ และเปลี่ยนกลับไม่ได้</p>
        <label className="block">
          <span className="text-sm font-semibold text-zinc-800">เหตุผลที่ยกเลิก (จำเป็น)</span>
          <textarea className={`${inputClass} mt-1.5 min-h-24`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className={CONTROL} disabled={busy} onClick={onClose}>
            ไม่ยกเลิก
          </Button>
          <Button variant="danger" className={CONTROL} disabled={busy || !reason.trim()} onClick={() => reason.trim() && onSubmit(reason.trim())}>
            ยกเลิกใบเสร็จ
          </Button>
        </div>
      </div>
    </div>
  );
}
