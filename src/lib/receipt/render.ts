import { rowHeight, WRAP_LINE_HEIGHT } from "./paginate";
import type { ReceiptField, ReceiptLayout, ReceiptPage, ReceiptSnapshot } from "@/types/store";

type RenderOptions = { copy: boolean; sample: boolean; page: ReceiptPage; dateText: string };
export const FONT = "'Sarabun','TH Sarabun New','Sukhumvit Set',Arial,sans-serif";
const INK = "#10122e";
const COPY_LABEL: ReceiptField = { x: 200, y: 77, size: 10, anchor: "middle" };
const SAMPLE_WATERMARK = { x: 200, y: 300, size: 60, opacity: 0.12, rotation: -25 };
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const BUDDHIST_YEAR_OFFSET = 543;

function escapeXml(value: string | number): string {
  // XML 1.0 permits tab, LF, and CR, but forbids the other C0 controls.
  return Array.from(String(value)).filter(character => {
    const code = character.charCodeAt(0);
    return code >= 32 || code === 9 || code === 10 || code === 13;
  }).join("").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

function text(value: string | number, field: ReceiptField): string {
  return `<text x="${field.x}" y="${field.y}" font-size="${field.size}" text-anchor="${field.anchor}">${escapeXml(value)}</text>`;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderRows(page: ReceiptPage, layout: ReceiptLayout): string {
  const { cols, size, firstY } = layout.table;
  let y = firstY;
  return page.rows.map(({ line, nameLines }) => {
    const cell = (key: keyof typeof cols, value: string | number, rowY = y) => text(value, { ...cols[key], y: rowY, size });
    const svg = cell("no", line.no) + nameLines.map((name, index) => cell("name", name, y + index * size * WRAP_LINE_HEIGHT)).join("")
      + cell("qty", line.quantity) + cell("price", money(line.unitPrice)) + cell("amount", money(line.amount));
    y += rowHeight(layout.table, nameLines.length);
    return svg;
  }).join("");
}

function renderCopy(layout: ReceiptLayout, snapshot: ReceiptSnapshot, opts: RenderOptions): string {
  const field = (key: keyof ReceiptLayout["fields"], value: string | number) => text(value, layout.fields[key]);
  let svg = field("date", opts.dateText) + field("receiptNo", snapshot.receiptNo)
    + field("customer", snapshot.customer.name) + field("studentId", snapshot.customer.studentCode)
    + field("school", snapshot.customer.school) + field("payeeName", snapshot.payeeName) + renderRows(opts.page, layout);
  // A single-page receipt needs no "1/1" mark.
  if (opts.page.pageCount > 1) svg += field("pageNo", `${opts.page.pageNo}/${opts.page.pageCount}`);
  if (opts.page.isLast) {
    svg += field("subtotal", money(snapshot.total)) + field("total", money(snapshot.total)) + field("words", `(${snapshot.totalText})`);
  }
  if (snapshot.signatureUrl) {
    const { x, y, width } = layout.signature;
    // A square viewport preserves the signature's aspect ratio without requiring image metadata.
    svg += `<image href="${escapeXml(snapshot.signatureUrl)}" x="${x}" y="${y}" width="${width}" height="${width}" preserveAspectRatio="xMidYMin meet"/>`;
  }
  if (opts.copy) svg += text("สำเนา / COPY", COPY_LABEL);
  if (opts.sample) {
    const { x, y, size, opacity, rotation } = SAMPLE_WATERMARK;
    svg += `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" opacity="${opacity}" transform="rotate(${rotation} ${x} ${y})">ตัวอย่าง</text>`;
  }
  return svg;
}

export function renderReceiptSvg(templateSvg: string, layout: ReceiptLayout, snapshot: ReceiptSnapshot, opts: RenderOptions): string {
  const closingTag = /<\/svg\s*>\s*$/i;
  if (!closingTag.test(templateSvg)) throw new Error("เทมเพลตใบเสร็จต้องเป็น SVG ที่สมบูรณ์");
  const content = renderCopy(layout, snapshot, opts);
  const copies = `<g font-family="${escapeXml(FONT)}" fill="${INK}">`
    + `<g data-receipt-copy="left">${content}</g>`
    + `<g data-receipt-copy="right" transform="translate(${layout.rightCopyOffset} 0)">${content}</g></g>`;
  return templateSvg.replace(closingTag, () => `${copies}</svg>`);
}

export function formatReceiptDate(iso: string): string {
  if (!iso) return "";
  let normalized = iso.replace(" ", "T");
  if (!/Z$|[+-]\d{2}:\d{2}$/i.test(normalized)) normalized += "Z";
  const date = new Date(new Date(normalized).getTime() + BANGKOK_OFFSET_MS);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear() + BUDDHIST_YEAR_OFFSET}`;
}

export const SAMPLE_SNAPSHOT: ReceiptSnapshot = {
  receiptNo: "SU-R2569-0001",
  issuedAt: "2026-10-14T19:00:00Z",
  customer: { name: "สมใจ ใจดี", studentCode: "6930000000", school: "สำนักวิชาศิลปศาสตร์" },
  lines: [
    { no: 1, name: "เสื้อรับน้อง ไซซ์ M", quantity: 1, unitPrice: 399, amount: 399 },
    { no: 2, name: "A01 เสื้อที่ระลึกลายมหาวิทยาลัยแม่ฟ้าหลวงสำหรับนักศึกษาใหม่ พร้อมภาพดอกไม้และภูเขาแห่งความทรงจำ รุ่นพิเศษประจำปีการศึกษา 2569", quantity: 2, unitPrice: 250, amount: 500 },
    { no: 3, name: "กระเป๋าผ้า", quantity: 1, unitPrice: 150, amount: 150 },
  ],
  total: 1049,
  totalText: "หนึ่งพันสี่สิบเก้าบาทถ้วน",
  payeeName: "สมศรี ใจดี",
  signatureUrl: "",
};
