"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { AdminApiError, adminFetch } from "@/lib/adminApi";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Button, Card, Field, inputClass, useToast } from "@/components/admin/ui";
import {
  ARROW_KEYS, moveSelection, nudgeRows, nudgeSelection, pxToViewBox, RECEIPT_VIEWBOX, resizeSelection,
  selectionOrigin, type Point, type Selection,
} from "@/lib/receipt/editorMath";
import { DEFAULT_LAYOUT } from "@/lib/receipt/layout";
import { createCanvasMeasure } from "@/lib/receipt/measure";
import { paginate } from "@/lib/receipt/paginate";
import { formatReceiptDate, renderReceiptSvg, SAMPLE_SNAPSHOT } from "@/lib/receipt/render";
import type { ReceiptLayout, ReceiptSettings } from "@/types/store";
import { COLUMN_LABEL, ColumnHandles } from "./ColumnHandles";
import { FIELD_LABEL, FieldHandles } from "./FieldHandles";
import { NudgePad } from "./NudgePad";

type Form = Pick<ReceiptSettings, "payeeName" | "signatureUrl" | "prefix" | "layout">;
type DragState = { selection: Selection; pointer: Point; origin: Point };

const SAMPLE_PRINT_URL = "/admin/receipts/sample/print";
const NON_SUPERADMIN_HINT = "เฉพาะผู้ดูแลระบบหลักแก้ได้";
const ROWS_PROBE_COUNT = 200; // more short lines than any page can hold, to find the per-page capacity
const SAVE_ROLE_ERROR = 403;
const CONTROL = "min-h-11";

function selectionLabel(selection: Selection | null): string {
  if (!selection) return "เลือกกล่องบนใบเสร็จ";
  if (selection.kind === "field") return FIELD_LABEL[selection.key];
  if (selection.kind === "signature") return "ลายเซ็น";
  return `คอลัมน์${COLUMN_LABEL[selection.key]}`;
}

function toForm(settings: ReceiptSettings): Form {
  const { payeeName, signatureUrl, prefix, layout } = settings;
  return { payeeName, signatureUrl, prefix, layout };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function ReceiptEditor() {
  const toast = useToast();
  const confirm = useConfirm();
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [nextReceiptNo, setNextReceiptNo] = useState("");
  const [template, setTemplate] = useState("");
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fontsReady, setFontsReady] = useState(0);
  const drag = useRef<DragState | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const measure = useMemo(() => createCanvasMeasure(), []);

  useEffect(() => {
    Promise.all([
      adminFetch<ReceiptSettings>("receipt-settings"),
      fetch("/api/admin/v2/receipt-template", { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error("โหลดแบบใบเสร็จไม่สำเร็จ");
        return res.text();
      }),
      adminFetch<{ isSuperadmin: boolean }>("me").catch(() => ({ isSuperadmin: false })), // the server still enforces Save
    ])
      .then(([settings, svg, me]) => {
        setSaved(toForm(settings));
        setForm(toForm(settings));
        setNextReceiptNo(settings.nextReceiptNo ?? "");
        setTemplate(svg);
        setIsSuperadmin(me.isSuperadmin);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  // Canvas measures with a fallback font until Sarabun loads; re-measure once it is ready.
  useEffect(() => {
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1));
  }, []);

  const dirty = form !== null && saved !== null && JSON.stringify(form) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setLayout = useCallback((update: (layout: ReceiptLayout) => ReceiptLayout) => {
    setForm((current) => (current ? { ...current, layout: update(current.layout) } : current));
  }, []);

  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      const step = ARROW_KEYS[event.key];
      if (!step || isEditableTarget(event.target)) return;
      event.preventDefault();
      setLayout((layout) => nudgeSelection(layout, selection, step[0], step[1]));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, setLayout]);

  const preview = useMemo(() => {
    if (!form || !template) return null;
    const snapshot = {
      ...SAMPLE_SNAPSHOT,
      receiptNo: `${form.prefix}0001`,
      payeeName: form.payeeName || SAMPLE_SNAPSHOT.payeeName,
      signatureUrl: form.signatureUrl,
    };
    const pages = paginate(snapshot.lines, form.layout, measure);
    const probe = Array.from({ length: ROWS_PROBE_COUNT }, (_, index) => ({ ...SAMPLE_SNAPSHOT.lines[0], no: index + 1, name: "ก" }));
    const rowsPerPage = paginate(probe, form.layout, measure)[0].rows.length;
    const svg = renderReceiptSvg(template, form.layout, snapshot, {
      copy: false, sample: true, page: pages[0], dateText: formatReceiptDate(snapshot.issuedAt),
    });
    const texts: Record<keyof ReceiptLayout["fields"], string> = {
      date: formatReceiptDate(snapshot.issuedAt), receiptNo: snapshot.receiptNo, customer: snapshot.customer.name,
      studentId: snapshot.customer.studentCode, school: snapshot.customer.school, subtotal: "1,049.00", total: "1,049.00",
      words: `(${snapshot.totalText})`, payeeName: snapshot.payeeName, pageNo: `1/${pages.length}`,
    };
    return { svg, texts, rowsPerPage };
    // fontsReady is a re-measure trigger: the measure function itself does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, template, measure, fontsReady]);

  function startDrag(target: Selection, event: PointerEvent<SVGElement>) {
    if (!form || !overlay.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection(target);
    drag.current = {
      selection: target,
      pointer: pxToViewBox(event.clientX, event.clientY, overlay.current.getBoundingClientRect()),
      origin: selectionOrigin(form.layout, target),
    };
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || !overlay.current) return;
    const point = pxToViewBox(event.clientX, event.clientY, overlay.current.getBoundingClientRect());
    const to = { x: current.origin.x + point.x - current.pointer.x, y: current.origin.y + point.y - current.pointer.y };
    setLayout((layout) => moveSelection(layout, current.selection, to));
  }

  async function uploadSignature(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const { url } = await adminFetch<{ url: string }>("images", { method: "POST", body });
      setForm((current) => (current ? { ...current, signatureUrl: url } : current));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const result = await adminFetch<ReceiptSettings>("receipt-settings", { method: "PUT", json: form });
      const next = toForm(result);
      setSaved(next);
      setForm(next);
      const fresh = await adminFetch<ReceiptSettings>("receipt-settings");
      setNextReceiptNo(fresh.nextReceiptNo ?? "");
      toast("บันทึกตั้งค่าใบเสร็จแล้ว");
    } catch (e) {
      toast(e instanceof AdminApiError && e.status === SAVE_ROLE_ERROR ? NON_SUPERADMIN_HINT : (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function resetLayout() {
    const ok = await confirm({
      title: "คืนค่าเริ่มต้น?",
      message: "ตำแหน่งและขนาดทั้งหมดบนใบเสร็จจะกลับเป็นค่าเริ่มต้น (ยังไม่บันทึกจนกว่าจะกดบันทึก)",
      confirmLabel: "คืนค่าเริ่มต้น",
      tone: "danger",
    });
    if (ok) setLayout(() => DEFAULT_LAYOUT);
  }

  // Opened synchronously inside the click so the browser does not treat it as a popup.
  const openTestPrint = () => window.open(SAMPLE_PRINT_URL, "_blank", "noopener");

  if (!form || !preview) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  const { layout } = form;
  // The sequence part comes from the server; only the prefix reflects what is being typed.
  const nextNo = `${form.prefix}${nextReceiptNo.slice(saved?.prefix.length ?? 0)}`;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">ตั้งค่าใบเสร็จ</h1>
        <p className="text-sm text-zinc-500">
          ลากกล่องสีฟ้าและเส้นสีส้มบนใบเสร็จฝั่งซ้ายไปวางตามช่อง สิ่งที่เห็นคือสิ่งที่จะพิมพ์ ฝั่งขวาเลื่อนตามอัตโนมัติ
        </p>
      </div>

      <div className="space-y-5">
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm">
          <div className="relative min-w-[720px] select-none">
            <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: preview.svg }} />
            <svg
              ref={overlay}
              viewBox={`0 0 ${RECEIPT_VIEWBOX.width} ${RECEIPT_VIEWBOX.height}`}
              className="absolute inset-0 h-full w-full"
              onPointerMove={moveDrag}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
            >
              <ColumnHandles layout={layout} selection={selection} onPointerDown={startDrag} onFocus={setSelection} />
              <FieldHandles
                layout={layout} texts={preview.texts} measure={measure} selection={selection}
                onPointerDown={startDrag} onFocus={setSelection}
              />
            </svg>
          </div>
        </div>

        <div className="grid items-start gap-4 md:grid-cols-2">
          <Card title={`กำลังขยับ: ${selectionLabel(selection)}`} hint="ลากบนใบเสร็จ หรือกดลูกศร (ใช้ปุ่มลูกศรบนคีย์บอร์ดได้) ครั้งละ 0.5 หน่วย">
            <NudgePad
              disabled={!selection}
              horizontalOnly={selection?.kind === "col"}
              onNudge={(dx, dy) => selection && setLayout((l) => nudgeSelection(l, selection, dx, dy))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-600">{selection?.kind === "signature" ? "ความกว้าง" : "ขนาดตัวอักษร"}</span>
              <Button variant="secondary" className="!h-11 !w-11 !p-0" aria-label="ลดขนาด" disabled={!selection}
                onClick={() => selection && setLayout((l) => resizeSelection(l, selection, -1))}>A−</Button>
              <Button variant="secondary" className="!h-11 !w-11 !p-0" aria-label="เพิ่มขนาด" disabled={!selection}
                onClick={() => selection && setLayout((l) => resizeSelection(l, selection, 1))}>A+</Button>
            </div>
          </Card>

          <Card title="ตารางรายการสินค้า" hint="ลากเส้นสีส้มเพื่อตั้งตำแหน่งแต่ละคอลัมน์ ตัวเลขชิดขวา/กึ่งกลางตามแนวเส้นอัตโนมัติ">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-600">แถวแรก</span>
              <Button variant="secondary" className="!h-11 !w-11 !p-0" aria-label="แถวแรกขึ้น" onClick={() => setLayout((l) => nudgeRows(l, -1, 0))}>↑</Button>
              <Button variant="secondary" className="!h-11 !w-11 !p-0" aria-label="แถวแรกลง" onClick={() => setLayout((l) => nudgeRows(l, 1, 0))}>↓</Button>
              <span className="ml-2 text-sm text-zinc-600">ระยะห่างแถว</span>
              <Button variant="secondary" className="!h-11 !w-11 !p-0" aria-label="ลดระยะห่างแถว" onClick={() => setLayout((l) => nudgeRows(l, 0, -1))}>−</Button>
              <Button variant="secondary" className="!h-11 !w-11 !p-0" aria-label="เพิ่มระยะห่างแถว" onClick={() => setLayout((l) => nudgeRows(l, 0, 1))}>+</Button>
            </div>
            <p className="mt-3 text-sm text-zinc-500">
              ชื่อยาวจะตัดขึ้นบรรทัดใหม่ในคอลัมน์ · ใบหนึ่งใส่ได้ <b className="text-zinc-900">{preview.rowsPerPage}</b> แถว
            </p>
          </Card>

          <Card title="ผู้รับเงิน">
            <div className="space-y-3">
              <Field label="ชื่อผู้รับเงิน">
                <input className={`${inputClass} ${CONTROL}`} maxLength={80} value={form.payeeName}
                  onChange={(e) => setForm({ ...form, payeeName: e.target.value })} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInput} type="file" accept="image/png" hidden onChange={(e) => uploadSignature(e.target.files?.[0])} />
                <Button variant="secondary" className={CONTROL} disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading ? "กำลังอัปโหลด..." : "อัปโหลดรูปลายเซ็น (PNG พื้นใส)"}
                </Button>
                {form.signatureUrl && (
                  <Button variant="ghost" className={CONTROL} onClick={() => setForm({ ...form, signatureUrl: "" })}>ลบรูปลายเซ็น</Button>
                )}
              </div>
            </div>
          </Card>

          <Card title="เลขที่ใบเสร็จ">
            <Field label="ตัวหน้าเลข" hint="ใช้ได้เฉพาะ A-Z, 0-9 และขีด (-) ไม่เกิน 20 ตัว">
              <input className={`${inputClass} ${CONTROL}`} maxLength={20} value={form.prefix}
                onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
            </Field>
            <p className="mt-2 text-sm text-zinc-500">
              ใบถัดไป: <b className="text-zinc-900">{nextNo}</b>{" "}
              · นับต่อเนื่อง ไม่ซ้ำ ทุกเครื่องใช้ชุดเดียวกัน
            </p>
          </Card>

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button className={CONTROL} disabled={!isSuperadmin || busy || !dirty} onClick={save}>บันทึก (ทุกเครื่องใช้ค่านี้)</Button>
            <Button variant="secondary" className={CONTROL} onClick={openTestPrint}>พิมพ์ทดสอบ</Button>
            <Button variant="ghost" className={CONTROL} onClick={resetLayout}>คืนค่าเริ่มต้น</Button>
          </div>
          {!isSuperadmin && <p className="text-sm text-amber-700 md:col-span-2">{NON_SUPERADMIN_HINT}</p>}
          {dirty && <p className="text-sm text-zinc-500 md:col-span-2">มีการเปลี่ยนแปลงที่ยังไม่บันทึก (พิมพ์ทดสอบใช้ค่าที่บันทึกแล้ว)</p>}
        </div>
      </div>
    </div>
  );
}
