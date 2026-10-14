import type { ReceiptLayout } from "@/types/store";

// Keep SVG viewBox units (812.98 × 597.12) identical to DEFAULT_LAYOUT in server/store/receipts.py.
export const DEFAULT_LAYOUT: ReceiptLayout = {
  rightCopyOffset: 421.19,
  fields: {
    date: { x: 384, y: 35, size: 9.5, anchor: "end" },
    receiptNo: { x: 384, y: 56, size: 9.5, anchor: "end" },
    customer: { x: 247.5, y: 93, size: 8, anchor: "start" },
    studentId: { x: 247.5, y: 112, size: 8, anchor: "start" },
    school: { x: 247.5, y: 131, size: 8, anchor: "start" },
    subtotal: { x: 374, y: 399, size: 9, anchor: "end" },
    total: { x: 374, y: 429, size: 9, anchor: "end" },
    words: { x: 128, y: 399, size: 7, anchor: "middle" },
    payeeName: { x: 61, y: 535, size: 8, anchor: "middle" },
    pageNo: { x: 384, y: 20, size: 7, anchor: "end" },
  },
  signature: { x: 30, y: 500, width: 62 },
  table: {
    firstY: 197, rowSpacing: 25, size: 7.5, bottomY: 385,
    cols: {
      no: { x: 11, width: 18, anchor: "middle" },
      name: { x: 40, width: 225, anchor: "start" },
      qty: { x: 290, width: 30, anchor: "end" },
      price: { x: 343, width: 40, anchor: "end" },
      amount: { x: 388, width: 45, anchor: "end" },
    },
  },
};
