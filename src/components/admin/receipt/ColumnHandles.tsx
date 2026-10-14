"use client";

import type { Selection } from "@/lib/receipt/editorMath";
import type { ReceiptLayout } from "@/types/store";
import type { HandleProps } from "./FieldHandles";

type ColumnKey = keyof ReceiptLayout["table"]["cols"];

export const COLUMN_LABEL: Record<ColumnKey, string> = {
  no: "ลำดับ", name: "รายการ", qty: "จำนวน", price: "ราคา", amount: "จำนวนเงิน",
};
const COLUMN_KEYS = Object.keys(COLUMN_LABEL) as ColumnKey[];
const ORANGE = "#f97316";
const HIT_WIDTH = 10;
const LABEL_SIZE = 5.5;
const LABEL_GAP = 12;

// Vertical guides at each column's anchor x, spanning the table body.
export function ColumnHandles({ layout, selection, onPointerDown, onFocus }: HandleProps) {
  const { firstY, bottomY, cols } = layout.table;
  return (
    <>
      {COLUMN_KEYS.map((key) => {
        const x = cols[key].x;
        const target: Selection = { kind: "col", key };
        const on = selection?.kind === "col" && selection.key === key;
        return (
          <g
            key={key}
            role="button"
            tabIndex={0}
            aria-label={`คอลัมน์${COLUMN_LABEL[key]}`}
            aria-pressed={on}
            style={{ cursor: "ew-resize", touchAction: "none", outline: "none" }}
            onPointerDown={(event) => onPointerDown(target, event)}
            onFocus={() => onFocus(target)}
          >
            <rect x={x - HIT_WIDTH / 2} y={firstY - LABEL_GAP} width={HIT_WIDTH} height={bottomY - firstY + LABEL_GAP} fill="transparent" />
            <line
              x1={x} x2={x} y1={firstY - LABEL_GAP / 2} y2={bottomY}
              stroke={ORANGE} strokeWidth={on ? 1.4 : 0.8} strokeDasharray={on ? undefined : "3 2"} pointerEvents="none"
            />
            <text x={x} y={firstY - LABEL_GAP / 2 - 1} fontSize={LABEL_SIZE} textAnchor="middle" fill="#c2410c" pointerEvents="none">
              {COLUMN_LABEL[key]}
            </text>
          </g>
        );
      })}
    </>
  );
}
