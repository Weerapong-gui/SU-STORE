"use client";

import { useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { createCanvasMeasure } from "@/lib/receipt/measure";
import { paginate } from "@/lib/receipt/paginate";
import { formatReceiptDate, renderReceiptSvg, SAMPLE_SNAPSHOT } from "@/lib/receipt/render";
import type { ReceiptSettings, ReceiptSnapshot, StoreReceipt } from "@/types/store";

// The template names its fonts by PostScript name, so each name maps to the one bundled collection.
const TEMPLATE_FONT_NAMES = ["Sukhumvit Set", "SukhumvitSet-Text", "SukhumvitSet-Medium", "SukhumvitSet-SemiBold", "SukhumvitSet-Bold"];
const FONT_FACES = TEMPLATE_FONT_NAMES.map(
  (name) => `@font-face{font-family:'${name}';src:url('/fonts/SukhumvitSet.ttc') format('truetype');font-display:block}`,
).join("");
const PAGE_WIDTH_PT = 812.98;
const PAGE_HEIGHT_PT = 597.12;
const PRINT_CSS = `
${FONT_FACES}
@page { size: ${PAGE_WIDTH_PT}pt ${PAGE_HEIGHT_PT}pt; margin: 0 }
.receipt-page { background: #fff; margin: 0 auto 16px; width: min(100%, ${PAGE_WIDTH_PT}pt); aspect-ratio: ${PAGE_WIDTH_PT} / ${PAGE_HEIGHT_PT} }
.receipt-page svg { display: block; width: 100%; height: 100% }
@media print {
  html, body { background: #fff !important; margin: 0 }
  .receipt-toolbar { display: none !important }
  .receipt-sheet { padding: 0 !important; background: #fff !important }
  .receipt-page { width: ${PAGE_WIDTH_PT}pt; height: ${PAGE_HEIGHT_PT}pt; margin: 0; break-after: page; page-break-after: always; overflow: hidden }
  .receipt-page:last-child { break-after: auto; page-break-after: auto }
}`;
const TEMPLATE_FONT_PROBE = "12px 'Sukhumvit Set'";
const SANS_FONT_PROBE = "12px 'Sarabun'";

type Loaded = { pages: string[]; receiptNo: string; signatureUrl: string };

async function waitForImage(url: string): Promise<void> {
  if (!url) return;
  // A broken signature must not block printing forever; the page prints without it.
  await new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
}

async function loadTemplate(): Promise<string> {
  const res = await fetch("/api/admin/v2/receipt-template", { cache: "no-store" });
  if (!res.ok) throw new Error("โหลดแบบใบเสร็จไม่สำเร็จ");
  return res.text();
}

async function loadReceipt(receiptId: number | null, settings: ReceiptSettings): Promise<{ snapshot: ReceiptSnapshot; receiptNo: string; issuedAt: string }> {
  if (receiptId === null) {
    const snapshot = { ...SAMPLE_SNAPSHOT, payeeName: settings.payeeName, signatureUrl: settings.signatureUrl };
    return { snapshot, receiptNo: snapshot.receiptNo, issuedAt: snapshot.issuedAt };
  }
  const receipt = await adminFetch<StoreReceipt>(`receipts/${receiptId}`);
  if (receipt.cancelledAt) throw new Error("ใบเสร็จนี้ถูกยกเลิกแล้ว พิมพ์ไม่ได้");
  return { snapshot: receipt.snapshot, receiptNo: receipt.receiptNo, issuedAt: receipt.issuedAt };
}

async function buildPages(receiptId: number | null, copy: boolean): Promise<Loaded> {
  const [settings, template] = await Promise.all([adminFetch<ReceiptSettings>("receipt-settings"), loadTemplate()]);
  const { snapshot, receiptNo, issuedAt } = await loadReceipt(receiptId, settings);
  // Wrapping is measured with canvas, so the text font must be ready before paginating.
  await document.fonts.load(SANS_FONT_PROBE);
  const pages = paginate(snapshot.lines, settings.layout, createCanvasMeasure());
  const dateText = formatReceiptDate(issuedAt);
  return {
    receiptNo,
    signatureUrl: snapshot.signatureUrl,
    pages: pages.map((page) => renderReceiptSvg(template, settings.layout, snapshot, { copy, sample: receiptId === null, page, dateText })),
  };
}

// receiptId null means the sample print (test layout with a watermark).
export function ReceiptPrintView({ receiptId, copy }: { receiptId: number | null; copy: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const printed = useRef(false);

  useEffect(() => {
    buildPages(receiptId, copy).then(setLoaded).catch((e: Error) => setError(e.message));
  }, [receiptId, copy]);

  useEffect(() => {
    if (!loaded || printed.current) return;
    printed.current = true;
    // The pages are in the DOM now, so this forces the template font to load before printing.
    Promise.all([document.fonts.load(TEMPLATE_FONT_PROBE), waitForImage(loaded.signatureUrl)])
      .then(() => document.fonts.ready)
      .then(() => requestAnimationFrame(() => window.print()));
  }, [loaded]);

  if (error) return <p className="p-6 text-base text-red-600">{error}</p>;
  if (!loaded) return <p className="p-6 text-base text-zinc-500">กำลังเตรียมใบเสร็จ…</p>;
  return (
    <div className="receipt-sheet min-h-screen bg-zinc-100 p-4">
      <style>{PRINT_CSS}</style>
      <div className="receipt-toolbar mx-auto mb-4 flex max-w-[812pt] items-center justify-between gap-3">
        <span className="text-base font-bold text-zinc-900">{loaded.receiptNo}</span>
        <button type="button" onClick={() => window.print()}
          className="min-h-11 min-w-[88px] rounded-xl bg-zinc-900 px-5 text-base font-bold text-white">
          พิมพ์
        </button>
      </div>
      {loaded.pages.map((svg, index) => (
        <div key={index} className="receipt-page" dangerouslySetInnerHTML={{ __html: svg }} />
      ))}
    </div>
  );
}
