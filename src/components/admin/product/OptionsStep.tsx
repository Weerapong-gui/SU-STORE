"use client";

import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Card, Field, inputClass } from "@/components/admin/ui";
import type { StoreProduct } from "@/types/store";
import { DesignsTable } from "./DesignsTable";
import type { DesignRow, DesignRowsUpdate } from "./designRows";
import { VariantsCard } from "./VariantsCard";
import type { VariantRow } from "./variants";

type OptionKind = StoreProduct["optionKind"];

const KINDS: { kind: OptionKind; title: string; hint: string }[] = [
  { kind: "options", title: "ไซซ์ / สี", hint: "เช่น เสื้อ S M L · สีดำ ขาว" },
  { kind: "designs", title: "หลายลาย", hint: "ราคาเดียว แต่ละลายมีรูปและสต็อกของตัวเอง" },
];

type Props = {
  /** True once the product exists on the server, so switching kind closes real variants. */
  saved: boolean;
  optionKind: OptionKind;
  onKindChange: (kind: OptionKind) => void;
  rows: VariantRow[];
  onRowsChange: (rows: VariantRow[]) => void;
  designRows: DesignRow[];
  designPrice: string;
  onDesignRowsChange: DesignRowsUpdate;
  onDesignPriceChange: (price: string) => void;
  /** Changes whenever the product reloads, so the size/colour inputs remount from saved data. */
  resetKey: string;
};

// Step 3 of the product editor: pick how the product varies, then fill in that branch.
export function OptionsStep(p: Props) {
  const confirm = useConfirm();

  async function chooseKind(kind: OptionKind) {
    if (kind === p.optionKind) return;
    if (p.saved) {
      const ok = await confirm({
        title: "เปลี่ยนแบบตัวเลือก?",
        message: "ตัวเลือกเดิมจะถูกปิดการขายเมื่อกดบันทึก (ตัวที่เคยมีคนสั่งแล้วยังอยู่ในประวัติออเดอร์)",
        confirmLabel: "เปลี่ยนแบบ",
        tone: "danger",
      });
      if (!ok) return;
    }
    p.onKindChange(kind);
  }

  const picker = (
    <div role="radiogroup" aria-label="แบบตัวเลือก" className="mb-5 grid gap-2 sm:grid-cols-2">
      {KINDS.map(({ kind, title, hint }) => (
        <label
          key={kind}
          className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${p.optionKind === kind ? "border-zinc-900 ring-2 ring-zinc-200" : "border-zinc-200 hover:bg-zinc-50"}`}
        >
          <input type="radio" name="optionKind" className="mt-1" checked={p.optionKind === kind} onChange={() => chooseKind(kind)} />
          <span>
            <span className="block text-sm font-semibold">{title}</span>
            <span className="block text-xs text-zinc-500">{hint}</span>
          </span>
        </label>
      ))}
    </div>
  );

  if (p.optionKind === "options") {
    return <VariantsCard key={p.resetKey} rows={p.rows} onChange={p.onRowsChange} header={picker} />;
  }
  return (
    <Card step={3} title="ตัวเลือก ราคา และสต็อก" hint="สินค้านี้มีตัวเลือกแบบไหน">
      {picker}
      <div className="mb-5 max-w-xs">
        <Field label="ราคาทุกลาย (บาท) *">
          <input className={inputClass} inputMode="numeric" value={p.designPrice} onChange={(e) => p.onDesignPriceChange(e.target.value.trim())} placeholder="79" />
        </Field>
      </div>
      <DesignsTable rows={p.designRows} onChange={p.onDesignRowsChange} />
    </Card>
  );
}
