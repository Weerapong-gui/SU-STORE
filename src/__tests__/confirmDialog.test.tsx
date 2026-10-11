import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfirmProvider, useConfirm, type ConfirmOptions } from "@/components/admin/ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let confirm: (options: ConfirmOptions) => Promise<boolean>;

function Capture() {
  confirm = useConfirm();
  return null;
}

// Returns the pending answer wrapped, so awaiting open() doesn't wait for the answer itself.
async function open(options: ConfirmOptions): Promise<{ answer: Promise<boolean> }> {
  let answer!: Promise<boolean>;
  await act(async () => {
    answer = confirm(options);
  });
  return { answer };
}

const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ConfirmProvider><Capture /></ConfirmProvider>));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ConfirmDialog", () => {
  it("resolves true when confirmed and closes", async () => {
    const { answer: result } = await open({ title: "เผยแพร่?", message: "ลูกค้าจะเห็นทันที", confirmLabel: "เผยแพร่" });
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("ลูกค้าจะเห็นทันที");
    expect(document.activeElement).toBe(button("เผยแพร่"));
    await act(async () => button("เผยแพร่").click());
    await expect(result).resolves.toBe(true);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
  });

  it("resolves false on Escape", async () => {
    const { answer: result } = await open({ title: "ลบ?", confirmLabel: "ลบ", tone: "danger" });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await expect(result).resolves.toBe(false);
  });

  it("focuses cancel for destructive actions", async () => {
    await open({ title: "ลบ?", confirmLabel: "ลบ", tone: "danger" });
    expect(document.activeElement).toBe(button("ยกเลิก"));
  });

  it("cancels the previous dialog when a second one opens", async () => {
    const { answer: first } = await open({ title: "หนึ่ง", confirmLabel: "ตกลง" });
    await open({ title: "สอง", confirmLabel: "ตกลง" });
    await expect(first).resolves.toBe(false);
    expect(document.querySelectorAll("[role=alertdialog]")).toHaveLength(1);
  });
});
