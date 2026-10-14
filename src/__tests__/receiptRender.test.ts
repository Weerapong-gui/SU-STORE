import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "@/lib/receipt/layout";
import { paginate } from "@/lib/receipt/paginate";
import { formatReceiptDate, renderReceiptSvg, SAMPLE_SNAPSHOT } from "@/lib/receipt/render";

const template = readFileSync("server/templates/receipt_template_v2.svg", "utf8");
const page = () => paginate(SAMPLE_SNAPSHOT.lines, DEFAULT_LAYOUT, text => text.length)[0];
const render = (copy = false, sample = false, isLast = true) => renderReceiptSvg(template, DEFAULT_LAYOUT, SAMPLE_SNAPSHOT, { copy, sample, page: { ...page(), isLast }, dateText: "15/10/2569" });

describe("receipt SVG", () => {
  it("renders the receipt number on both copies and preserves the template", () => {
    const svg = render();
    expect(svg.split(SAMPLE_SNAPSHOT.receiptNo)).toHaveLength(3);
    expect(svg).toContain('viewBox="0 0 812.98 597.12"');
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelectorAll('g[data-receipt-copy]')).toHaveLength(2);
    expect(doc.querySelector('[data-receipt-copy="right"]')?.getAttribute("transform")).toBe(`translate(${DEFAULT_LAYOUT.rightCopyOffset} 0)`);
  });
  it("shows the page number only on multi-page receipts", () => {
    const multi = renderReceiptSvg(template, DEFAULT_LAYOUT, SAMPLE_SNAPSHOT, {
      copy: false, sample: false, page: { ...page(), pageNo: 2, pageCount: 3 }, dateText: "15/10/2569",
    });
    expect(multi).toContain(">2/3<");
    expect(render()).not.toContain(">1/1<");
  });
  it("marks copies only on reprints", () => {
    expect(render()).not.toContain("สำเนา");
    expect(render(true)).toContain("สำเนา / COPY");
  });
  it("renders totals and words only on the final page", () => {
    const total = SAMPLE_SNAPSHOT.total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(render()).toContain(total);
    expect(render()).toContain("1,049.00");
    expect(render(false, false, false)).not.toContain(total);
    expect(render(false, false, false)).not.toContain(SAMPLE_SNAPSHOT.totalText);
  });
  it("escapes customer, row text, and signature attributes", () => {
    const snapshot = { ...SAMPLE_SNAPSHOT, customer: { ...SAMPLE_SNAPSHOT.customer, name: '<script> & "name"' }, signatureUrl: '/signature?a=1&b="test"' };
    const receiptPage = { ...page(), rows: [{ line: snapshot.lines[0], nameLines: ["<script>"] }] };
    const svg = renderReceiptSvg(template, DEFAULT_LAYOUT, snapshot, { copy: false, sample: false, page: receiptPage, dateText: "date" });
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('href="/signature?a=1&amp;b=&quot;test&quot;"');
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
  });
  it("preserves replacement patterns verbatim in customer, school, and line names", () => {
    const name = "$& $$ $' $`";
    const line = { ...SAMPLE_SNAPSHOT.lines[0], name };
    const snapshot = { ...SAMPLE_SNAPSHOT, customer: { ...SAMPLE_SNAPSHOT.customer, name, school: name }, lines: [line] };
    const receiptPage = paginate(snapshot.lines, DEFAULT_LAYOUT, text => text.length)[0];
    const svg = renderReceiptSvg(template, DEFAULT_LAYOUT, snapshot, { copy: false, sample: false, page: receiptPage, dateText: "date" });
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    for (const copy of doc.querySelectorAll("g[data-receipt-copy]")) {
      expect(Array.from(copy.querySelectorAll("text"), element => element.textContent).filter(text => text === name)).toHaveLength(3);
    }
  });
  it("strips XML 1.0 forbidden controls while preserving allowed whitespace", () => {
    const controls = Array.from({ length: 32 }, (_, code) => code).filter(code => ![9, 10, 13].includes(code)).map(code => String.fromCharCode(code)).join("");
    const snapshot = { ...SAMPLE_SNAPSHOT, customer: { ...SAMPLE_SNAPSHOT.customer, name: `before${controls}after\tallowed\nspace` } };
    const svg = renderReceiptSvg(template, DEFAULT_LAYOUT, snapshot, { copy: false, sample: false, page: page(), dateText: "date" });
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(Array.from(doc.querySelectorAll("text"), element => element.textContent)).toContain("beforeafter\tallowed\nspace");
  });
  it("adds a sample watermark only for previews", () => {
    expect(render(false, true)).toContain("ตัวอย่าง");
    expect(render()).not.toContain("ตัวอย่าง");
  });
});

describe("receipt dates", () => {
  it.each(["2026-10-14T19:00:00Z", "2026-10-14 19:00:00", "2026-10-15T02:00:00+07:00"])("formats Bangkok Buddhist dates: %s", iso => {
    expect(formatReceiptDate(iso)).toBe("15/10/2569");
  });
});
