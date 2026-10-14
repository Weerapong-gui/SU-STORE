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

  async function renderWithReceipt(superadmin: boolean) {
    isSuperadmin = superadmin;
    receipts = [{ id: 1, receiptNo: "SU-R2569-0001", issuedAt: "2026-10-15T00:00:00Z", issuedBy: "a", cancelledAt: null }];
    await render(order("paid", {}));
  }

  it("hides cancel for non-superadmin", async () => {
    await renderWithReceipt(false);
    expect(button("ยกเลิกใบเสร็จ")).toBeUndefined();
    expect(button("พิมพ์ซ้ำ (สำเนา)")).toBeDefined();
  });

  it("shows cancel for superadmin", async () => {
    await renderWithReceipt(true);
    expect(button("ยกเลิกใบเสร็จ")).toBeDefined();
  });

  const posts = (suffix: string) => adminFetch.mock.calls.filter(([path, init]) => String(path).endsWith(suffix) && init?.method === "POST");
  const getCalls = () => adminFetch.mock.calls.filter(([path]) => String(path).endsWith("/receipts")).length;

  describe("issue flow", () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    beforeEach(() => {
      tab.location.href = "";
      tab.close.mockReset();
      vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
      adminFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
        if (path === "me") return { username: "a", isSuperadmin };
        if (init?.method === "POST") return { id: 7 };
        return { receipts, warning: null };
      });
    });
    afterEach(() => vi.restoreAllMocks());

    async function openDialogAndEditName() {
      await render(order("paid", { name: "สมชาย", studentCode: "6931", school: "School of Dentistry" }));
      await act(async () => button("ออกใบเสร็จ")!.click());
      const name = document.querySelector<HTMLInputElement>('input')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "สมหญิง");
        name.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    it("sends one POST on double click, with the staff-edited customer, and refetches", async () => {
      await openDialogAndEditName();
      const before = getCalls();
      const confirmBtn = button("ออกใบเสร็จและพิมพ์")!;
      await act(async () => {
        confirmBtn.click();
        confirmBtn.click();
      });
      expect(posts("/receipt")).toHaveLength(1);
      expect(posts("/receipt")[0][1].json).toEqual({
        customer: { name: "สมหญิง", studentCode: "6931", school: "School of Dentistry" },
      });
      expect(getCalls()).toBeGreaterThan(before);
      expect(tab.location.href).toBe("/admin/receipts/7/print?copy=0");
    });

    it("closes the pre-opened tab when the POST fails", async () => {
      await openDialogAndEditName();
      adminFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
        if (init?.method === "POST") throw new Error("ล้มเหลว");
        return path === "me" ? { isSuperadmin } : { receipts, warning: null };
      });
      await act(async () => button("ออกใบเสร็จและพิมพ์")!.click());
      expect(tab.close).toHaveBeenCalled();
    });
  });

  describe("cancel flow", () => {
    const dialogButton = () =>
      [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "ยกเลิกใบเสร็จ") as HTMLButtonElement;

    it("sends no request while the reason is empty", async () => {
      await renderWithReceipt(true);
      await act(async () => button("ยกเลิกใบเสร็จ")!.click());
      await act(async () => dialogButton().click());
      expect(posts("/cancel")).toHaveLength(0);
    });

    it("posts the reason and refetches receipts", async () => {
      await renderWithReceipt(true);
      await act(async () => button("ยกเลิกใบเสร็จ")!.click());
      const before = getCalls();
      const reason = document.querySelector<HTMLTextAreaElement>("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "ออกผิด");
        reason.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => dialogButton().click());
      expect(posts("/cancel")).toHaveLength(1);
      expect(posts("/cancel")[0][1].json).toEqual({ reason: "ออกผิด" });
      expect(getCalls()).toBeGreaterThan(before);
    });
  });
});
