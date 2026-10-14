"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { formatReceiptDate } from "@/lib/receipt/render";
import { Button, Card, useToast } from "@/components/admin/ui";
import type { IssuedReceipt, OrderStatus, StoreOrder, StoreReceipt } from "@/types/store";
import { CancelReceiptDialog } from "./CancelReceiptDialog";
import { CONTROL } from "./controls";
import { IssueReceiptDialog, type ReceiptCustomer } from "./IssueReceiptDialog";

// Statuses the order-api accepts for issuing (server/store receipts rule).
const ISSUABLE_STATUSES: OrderStatus[] = ["paid", "ready", "completed"];

type ReceiptsResponse = { receipts: StoreReceipt[]; warning: string | null };

// Task 6 owns the print page; staff stay on the order page, so it opens in a new tab.
function receiptPrintUrl(receiptId: number, opts: { copy: boolean }) {
  return `/admin/receipts/${receiptId}/print?copy=${opts.copy ? 1 : 0}`;
}

export function openReceiptPrint(receiptId: number, opts: { copy: boolean }) {
  window.open(receiptPrintUrl(receiptId, opts), "_blank", "noopener");
}

function customerFromOrder(order: StoreOrder): ReceiptCustomer {
  return {
    name: order.customer.name ?? "",
    studentCode: order.customer.studentCode ?? "",
    school: order.customer.school ?? "",
  };
}

export function ReceiptPanel({ order }: { order: StoreOrder }) {
  const toast = useToast();
  const [receipts, setReceipts] = useState<StoreReceipt[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockedPrintUrl, setBlockedPrintUrl] = useState<string | null>(null);
  const reprintRef = useRef<HTMLButtonElement>(null);
  const focusReprintNext = useRef(false);
  const inFlight = useRef(false); // state lags a double click; the ref blocks the second request

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<ReceiptsResponse>(`orders/${order.orderCode}/receipts`);
      setReceipts(data.receipts);
      setWarning(data.warning);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [order.orderCode, toast]);

  // A status change on this page (e.g. cancelled) can flip the warning, so it re-triggers the fetch.
  useEffect(() => {
    load();
  }, [load, order.status]);

  useEffect(() => {
    adminFetch<{ isSuperadmin: boolean }>("me")
      .then((me) => setIsSuperadmin(me.isSuperadmin))
      .catch(() => setIsSuperadmin(false)); // hiding cancel is the safe default; the server still enforces it
  }, []);

  const active = receipts.find((r) => !r.cancelledAt) ?? null;
  const history = receipts.filter((r) => r.cancelledAt);
  const canIssue = !active && ISSUABLE_STATUSES.includes(order.status);

  // The opener button unmounts once a receipt exists, so hand focus to the reprint button.
  useEffect(() => {
    if (active && focusReprintNext.current) {
      focusReprintNext.current = false;
      reprintRef.current?.focus();
    }
  }, [active]);

  async function issue(customer: ReceiptCustomer) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setBlockedPrintUrl(null);
    // Opened inside the click so browsers don't treat it as a popup; pointed at the print page after the POST.
    const tab = window.open("", "_blank");
    try {
      const receipt = await adminFetch<IssuedReceipt>(`orders/${order.orderCode}/receipt`, { method: "POST", json: { customer } });
      // Someone else may have issued it first; a second "original" must never print.
      const alreadyIssued = receipt.created === false;
      const printUrl = receiptPrintUrl(receipt.id, { copy: alreadyIssued });
      if (alreadyIssued) toast("ใบเสร็จนี้ออกไปแล้ว พิมพ์เป็นสำเนา");
      if (tab) {
        tab.location.href = printUrl;
      } else {
        setBlockedPrintUrl(printUrl);
        toast("เบราว์เซอร์บล็อกการเปิดแท็บใหม่ กดปุ่ม \"เปิดหน้าพิมพ์ใบเสร็จ\" เพื่อพิมพ์", "error");
      }
      focusReprintNext.current = true;
      setIssuing(false);
      void load();
    } catch (e) {
      tab?.close();
      toast((e as Error).message, "error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function cancel(receipt: StoreReceipt, reason: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await adminFetch(`receipts/${receipt.id}/cancel`, { method: "POST", json: { reason } });
      setCancelling(false);
      setBlockedPrintUrl(null);
      toast("ยกเลิกใบเสร็จแล้ว");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Card title="ใบเสร็จ">
      <div className="space-y-3">
        {warning && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {warning}
          </p>
        )}
        {active ? (
          <div className="space-y-2">
            <p className="font-mono text-base font-bold">{active.receiptNo}</p>
            <p className="text-xs text-zinc-500">ออกเมื่อ {formatReceiptDate(active.issuedAt)} โดย {active.issuedBy}</p>
            {blockedPrintUrl && (
              <a
                href={blockedPrintUrl}
                target="_blank"
                rel="noopener"
                className={`${CONTROL} inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-700`}
              >
                เปิดหน้าพิมพ์ใบเสร็จ
              </a>
            )}
            <Button ref={reprintRef} variant="secondary" className={`${CONTROL} w-full`} onClick={() => openReceiptPrint(active.id, { copy: true })}>
              พิมพ์ซ้ำ (สำเนา)
            </Button>
            {isSuperadmin && (
              <Button variant="danger" className={`${CONTROL} w-full`} disabled={busy} onClick={() => setCancelling(true)}>
                ยกเลิกใบเสร็จ
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">ยังไม่มีใบเสร็จที่ใช้งานอยู่</p>
        )}
        {canIssue && (
          <Button className={`${CONTROL} w-full`} disabled={busy} onClick={() => setIssuing(true)}>
            ออกใบเสร็จ
          </Button>
        )}
        {history.length > 0 && (
          <div className="border-t border-zinc-100 pt-3">
            <p className="mb-1 text-xs font-semibold text-zinc-500">ใบเสร็จที่ยกเลิกแล้ว</p>
            <ul className="space-y-1.5 text-xs text-zinc-500">
              {history.map((r) => (
                <li key={r.id}>
                  <span className="font-mono line-through">{r.receiptNo}</span> · ยกเลิก {formatReceiptDate(r.cancelledAt ?? "")} โดย{" "}
                  {r.cancelledBy} · เหตุผล: {r.cancelReason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {issuing && (
        <IssueReceiptDialog initial={customerFromOrder(order)} busy={busy} onSubmit={issue} onClose={() => setIssuing(false)} />
      )}
      {cancelling && active && (
        <CancelReceiptDialog receipt={active} busy={busy} onSubmit={(reason) => cancel(active, reason)} onClose={() => setCancelling(false)} />
      )}
    </Card>
  );
}
