"use client";

import { Button, Card } from "@/components/admin/ui";
import { nudgeSelection, resizeSelection, type Selection } from "@/lib/receipt/editorMath";
import type { ReceiptLayout } from "@/types/store";
import { COLUMN_LABEL } from "./ColumnHandles";
import { TOUCH_ICON_BUTTON } from "./controls";
import { FIELD_LABEL } from "./FieldHandles";
import { NudgePad } from "./NudgePad";

function selectionLabel(selection: Selection | null): string {
  if (!selection) return "เลือกกล่องบนใบเสร็จ";
  if (selection.kind === "field") return FIELD_LABEL[selection.key];
  if (selection.kind === "signature") return "ลายเซ็น";
  return `คอลัมน์${COLUMN_LABEL[selection.key]}`;
}

export function NudgeCard({ selection, setLayout }: {
  selection: Selection | null;
  setLayout: (update: (layout: ReceiptLayout) => ReceiptLayout) => void;
}) {
  return (
    <Card title={`กำลังขยับ: ${selectionLabel(selection)}`} hint="ลากบนใบเสร็จ หรือกดลูกศร (ใช้ปุ่มลูกศรบนคีย์บอร์ดได้) ครั้งละ 0.5 หน่วย">
      <NudgePad
        disabled={!selection}
        horizontalOnly={selection?.kind === "col"}
        onNudge={(dx, dy) => selection && setLayout((l) => nudgeSelection(l, selection, dx, dy))}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-600">{selection?.kind === "signature" ? "ความกว้าง" : "ขนาดตัวอักษร"}</span>
        <Button variant="secondary" className={TOUCH_ICON_BUTTON} aria-label="ลดขนาด" disabled={!selection}
          onClick={() => selection && setLayout((l) => resizeSelection(l, selection, -1))}>A−</Button>
        <Button variant="secondary" className={TOUCH_ICON_BUTTON} aria-label="เพิ่มขนาด" disabled={!selection}
          onClick={() => selection && setLayout((l) => resizeSelection(l, selection, 1))}>A+</Button>
      </div>
    </Card>
  );
}
