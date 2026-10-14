"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { formatReceiptDate } from "@/lib/receipt/render";
import { Button, Card, useToast } from "@/components/admin/ui";
import type { OrderStatus, StoreOrder, StoreReceipt } from "@/types/store";
import { CancelReceiptDialog } from "./CancelReceiptDialog";
import { IssueReceiptDialog, type ReceiptCustomer } from "./IssueReceiptDialog";

// Statuses the order-api accepts for issuing (server/store receipts rule).
const ISSUABLE_STATUSES: OrderStatus[] = ["paid", "ready", "completed"];
const CONTROL = "min-h-11";

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

  useEffect(() => {
    load();
    adminFetch<{ isSuperadmin: boolean }>("me")
      .then((me) => setIsSuperadmin(me.isSuperadmin))
      .catch(() => setIsSuperadmin(false)); // hiding cancel is the safe default; the server still enforces it
  }, [load]);

  const active = receipts.find((r) => !r.cancelledAt) ?? null;
  const history = receipts.filter((r) => r.cancelledAt);
  const canIssue = !active && ISSUABLE_STATUSES.includes(order.status);

  async function issue(customer: ReceiptCustomer) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    // Opened inside the click so browsers don't treat it as a popup; pointed at the print page after the POST.
    const tab = window.open("", "_blank");
    try {
      const receipt = await adminFetch<StoreReceipt>(`orders/${order.orderCode}/receipt`, { method: "POST", json: { customer } });
      if (tab) tab.location.href = receiptPrintUrl(receipt.id, { copy: false });
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
            <Button variant="secondary" className={`${CONTROL} w-full`} onClick={() => openReceiptPrint(active.id, { copy: true })}>
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
