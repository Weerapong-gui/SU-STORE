"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { AdminApiError, adminFetch } from "@/lib/adminApi";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Button, useToast } from "@/components/admin/ui";
import {
  ARROW_KEYS, moveSelection, nudgeSelection, pxToViewBox, RECEIPT_VIEWBOX, selectionOrigin, type Point, type Selection,
} from "@/lib/receipt/editorMath";
import { DEFAULT_LAYOUT } from "@/lib/receipt/layout";
import { createCanvasMeasure } from "@/lib/receipt/measure";
import { paginate } from "@/lib/receipt/paginate";
import { formatReceiptDate, renderReceiptSvg, SAMPLE_SNAPSHOT } from "@/lib/receipt/render";
import { loadReceiptTemplate } from "@/lib/receipt/template";
import type { ReceiptLayout, ReceiptSettings } from "@/types/store";
import { ColumnHandles } from "./ColumnHandles";
import { CONTROL } from "./controls";
import { FieldHandles } from "./FieldHandles";
import { NudgeCard } from "./NudgeCard";
import { PayeeCard } from "./PayeeCard";
import { PrefixCard } from "./PrefixCard";
import { TableCard } from "./TableCard";

type Form = Pick<ReceiptSettings, "payeeName" | "signatureUrl" | "prefix" | "layout">;
type DragState = { selection: Selection; pointer: Point; origin: Point };

const SAMPLE_PRINT_URL = "/admin/receipts/sample/print";
const NON_SUPERADMIN_HINT = "เฉพาะผู้ดูแลระบบหลักแก้ได้";
const ROWS_PROBE_COUNT = 200; // more short lines than any page can hold, to find the per-page capacity
const SAVE_ROLE_ERROR = 403;

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
  const [fontsReady, setFontsReady] = useState(0);
  const drag = useRef<DragState | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const measure = useMemo(() => createCanvasMeasure(), []);

  useEffect(() => {
    Promise.all([
      adminFetch<ReceiptSettings>("receipt-settings"),
      loadReceiptTemplate(),
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

  const updateForm = useCallback((patch: Partial<Form>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }, []);

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
    if (event.button !== 0 || !form || !overlay.current) return; // right/middle click must not start a drag
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

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const result = await adminFetch<ReceiptSettings>("receipt-settings", { method: "PUT", json: form });
      const next = toForm(result);
      setSaved(next);
      setForm(next);
      toast("บันทึกตั้งค่าใบเสร็จแล้ว");
      await refreshNextReceiptNo();
    } catch (e) {
      toast(e instanceof AdminApiError && e.status === SAVE_ROLE_ERROR ? NON_SUPERADMIN_HINT : (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // The save already succeeded; if only this refresh fails the old number stays on screen until the next load.
  async function refreshNextReceiptNo() {
    try {
      const fresh = await adminFetch<ReceiptSettings>("receipt-settings");
      setNextReceiptNo(fresh.nextReceiptNo ?? "");
    } catch {
      // Quiet on purpose: the saved settings are already in place.
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
          <NudgeCard selection={selection} setLayout={setLayout} />
          <TableCard rowsPerPage={preview.rowsPerPage} setLayout={setLayout} />
          <PayeeCard payeeName={form.payeeName} signatureUrl={form.signatureUrl} onChange={updateForm} />
          <PrefixCard prefix={form.prefix} nextNo={nextNo} onChange={(prefix) => updateForm({ prefix })} />

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
