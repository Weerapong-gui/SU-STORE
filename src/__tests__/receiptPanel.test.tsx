import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptPanel } from "@/components/admin/receipt/ReceiptPanel";
import { ToastProvider } from "@/components/admin/ui";
import type { StoreOrder } from "@/types/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const adminFetch = vi.fn();
vi.mock("@/lib/adminApi", () => ({ adminFetch: (...args: unknown[]) => adminFetch(...args) }));

let container: HTMLDivElement;
let root: Root;
let isSuperadmin = false;
let receipts: unknown[] = [];

function order(status: StoreOrder["status"], customer: Record<string, string>): StoreOrder {
  return { orderCode: "SU0001", status, customer } as StoreOrder;
}

async function render(o: StoreOrder) {
  await act(async () => {
    root.render(
      <ToastProvider>
        <ReceiptPanel order={o} />
      </ToastProvider>
    );
  });
}

const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

beforeEach(() => {
  isSuperadmin = false;
  receipts = [];
  adminFetch.mockReset();
  adminFetch.mockImplementation(async (path: string) =>
    path === "me" ? { username: "a", isSuperadmin } : { receipts, warning: null }
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ReceiptPanel", () => {
  it("hides the issue button for pending_payment", async () => {
    await render(order("pending_payment", {}));
    expect(button("ออกใบเสร็จ")).toBeUndefined();
  });

  it("warns in the issue dialog when the student code is empty", async () => {
    await render(order("paid", { name: "สมชาย", studentCode: "", school: "School of Dentistry" }));
    await act(async () => button("ออกใบเสร็จ")!.click());
    expect(document.body.textContent).toContain("ช่องว่างอาจทำให้ใช้ใบเสร็จเบิกเงินไม่ได้");
  });

  it("hides cancel for non-superadmin and shows it for superadmin", async () => {
    receipts = [{ id: 1, receiptNo: "SU-R2569-0001", issuedAt: "2026-10-15T00:00:00Z", issuedBy: "a", cancelledAt: null }];
    await render(order("paid", {}));
    expect(button("ยกเลิกใบเสร็จ")).toBeUndefined();
    expect(button("พิมพ์ซ้ำ (สำเนา)")).toBeDefined();

    isSuperadmin = true;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(order("paid", {}));
    expect(button("ยกเลิกใบเสร็จ")).toBeDefined();
  });
});
