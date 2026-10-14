"use client";

import type { PointerEvent } from "react";
import { fieldBox, type Selection } from "@/lib/receipt/editorMath";
import type { Measure } from "@/lib/receipt/measure";
import type { ReceiptLayout } from "@/types/store";

type FieldKey = keyof ReceiptLayout["fields"];
export type HandleProps = {
  layout: ReceiptLayout;
  selection: Selection | null;
  onPointerDown: (selection: Selection, event: PointerEvent<SVGElement>) => void;
  onFocus: (selection: Selection) => void;
};

export const FIELD_LABEL: Record<FieldKey, string> = {
  date: "วันที่", receiptNo: "เลขที่", customer: "ชื่อลูกค้า", studentId: "รหัสนักศึกษา", school: "สำนักวิชา",
  subtotal: "รวมเป็นเงิน", total: "รวมทั้งสิ้น", words: "จำนวนเงินตัวอักษร", payeeName: "ชื่อผู้รับเงิน", pageNo: "เลขหน้า",
};
const FIELD_KEYS = Object.keys(FIELD_LABEL) as FieldKey[];
const HANDLE_FILL = "rgba(0,113,227,0.12)";
const HANDLE_STROKE = "#0071e3";
const MIN_BOX_WIDTH = 14;
const BOX_PADDING = 1.5;
const STROKE_WIDTH = 0.7;
const SIGNATURE_LABEL_SIZE = 6;

function isSelected(selection: Selection | null, target: Selection): boolean {
  const id = (value: Selection) => `${value.kind}:${"key" in value ? value.key : ""}`;
  return selection !== null && id(selection) === id(target);
}

export function FieldHandles({ layout, texts, measure, selection, onPointerDown, onFocus }: HandleProps & {
  texts: Record<FieldKey, string>;
  measure: Measure;
}) {
  const boxProps = (target: Selection, label: string) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    "aria-pressed": isSelected(selection, target),
    style: { cursor: "grab", touchAction: "none", outline: "none" },
    onPointerDown: (event: PointerEvent<SVGElement>) => onPointerDown(target, event),
    onFocus: () => onFocus(target),
  });
  const style = (target: Selection) => {
    const on = isSelected(selection, target);
    return {
      fill: on ? "rgba(0,113,227,0.25)" : HANDLE_FILL,
      stroke: HANDLE_STROKE,
      strokeWidth: on ? STROKE_WIDTH * 1.6 : STROKE_WIDTH,
      strokeDasharray: on ? undefined : "2 1.5",
    };
  };

  return (
    <>
      {FIELD_KEYS.map((key) => {
        const field = layout.fields[key];
        const box = fieldBox(field, Math.max(measure(texts[key], field.size), MIN_BOX_WIDTH));
        const target: Selection = { kind: "field", key };
        return (
          <rect
            key={key}
            x={box.x - BOX_PADDING}
            y={box.y - BOX_PADDING}
            width={box.width + BOX_PADDING * 2}
            height={box.height + BOX_PADDING * 2}
            rx={1.5}
            {...style(target)}
            {...boxProps(target, FIELD_LABEL[key])}
          />
        );
      })}
      <g>
        <rect
          x={layout.signature.x}
          y={layout.signature.y}
          width={layout.signature.width}
          height={layout.signature.width / 2}
          rx={1.5}
          {...style({ kind: "signature" })}
          {...boxProps({ kind: "signature" }, "ลายเซ็น")}
        />
        <text
          x={layout.signature.x + layout.signature.width / 2}
          y={layout.signature.y + layout.signature.width / 4 + SIGNATURE_LABEL_SIZE / 3}
          fontSize={SIGNATURE_LABEL_SIZE}
          textAnchor="middle"
          fill={HANDLE_STROKE}
          pointerEvents="none"
        >
          ลายเซ็น
        </text>
      </g>
    </>
  );
}
