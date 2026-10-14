"use client";

import { Button, Card } from "@/components/admin/ui";
import { nudgeRows } from "@/lib/receipt/editorMath";
import type { ReceiptLayout } from "@/types/store";
import { TOUCH_ICON_BUTTON } from "./controls";

export function TableCard({ rowsPerPage, setLayout }: {
  rowsPerPage: number;
  setLayout: (update: (layout: ReceiptLayout) => ReceiptLayout) => void;
}) {
  return (
    <Card title="ตารางรายการสินค้า" hint="ลากเส้นสีส้มเพื่อตั้งตำแหน่งแต่ละคอลัมน์ ตัวเลขชิดขวา/กึ่งกลางตามแนวเส้นอัตโนมัติ">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-600">แถวแรก</span>
        <Button variant="secondary" className={TOUCH_ICON_BUTTON} aria-label="แถวแรกขึ้น" onClick={() => setLayout((l) => nudgeRows(l, -1, 0))}>↑</Button>
        <Button variant="secondary" className={TOUCH_ICON_BUTTON} aria-label="แถวแรกลง" onClick={() => setLayout((l) => nudgeRows(l, 1, 0))}>↓</Button>
        <span className="ml-2 text-sm text-zinc-600">ระยะห่างแถว</span>
        <Button variant="secondary" className={TOUCH_ICON_BUTTON} aria-label="ลดระยะห่างแถว" onClick={() => setLayout((l) => nudgeRows(l, 0, -1))}>−</Button>
        <Button variant="secondary" className={TOUCH_ICON_BUTTON} aria-label="เพิ่มระยะห่างแถว" onClick={() => setLayout((l) => nudgeRows(l, 0, 1))}>+</Button>
      </div>
      <p className="mt-3 text-sm text-zinc-500">
        ชื่อยาวจะตัดขึ้นบรรทัดใหม่ในคอลัมน์ · ใบหนึ่งใส่ได้ <b className="text-zinc-900">{rowsPerPage}</b> แถว
      </p>
    </Card>
  );
}
