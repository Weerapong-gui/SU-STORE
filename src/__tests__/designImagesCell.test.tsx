import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignImagesCell } from "@/components/admin/product/DesignImagesCell";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { ToastProvider } from "@/components/admin/ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/adminApi", () => ({ adminFetch: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
let images: string[];
const onChange = vi.fn((update: (prev: string[]) => string[]) => {
  images = update(images);
});

async function render() {
  await act(async () => {
    root.render(
      <ToastProvider>
        <ConfirmProvider>
          <DesignImagesCell images={images} designCode="SCI" onChange={onChange} />
        </ConfirmProvider>
      </ToastProvider>
    );
  });
}

const addButton = () => container.querySelector('button[aria-label="เพิ่มรูป"]');
const buttonsByLabel = (label: string) => [...container.querySelectorAll(`button[aria-label^="${label}"]`)] as HTMLButtonElement[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onChange.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("DesignImagesCell", () => {
  it("hides the add button at 8 images", async () => {
    images = Array.from({ length: 8 }, (_, i) => `/product-images/${i}.png`);
    await render();
    expect(addButton()).toBeNull();
  });

  it("shows the add button below 8 images and marks the first as main", async () => {
    images = ["/product-images/a.png", "/product-images/b.png"];
    await render();
    expect(addButton()).not.toBeNull();
    expect(container.textContent).toContain("รูปหลัก");
  });

  it("hides the move buttons at the ends and moves an image", async () => {
    images = ["a", "b"];
    await render();
    expect(buttonsByLabel("เลื่อนรูปไปซ้าย")).toHaveLength(1);
    expect(buttonsByLabel("เลื่อนรูปไปขวา")).toHaveLength(1);
    await act(async () => buttonsByLabel("เลื่อนรูปไปซ้าย")[0].click());
    expect(images).toEqual(["b", "a"]);
  });

  it("removes an image only after confirming", async () => {
    images = ["a", "b"];
    await render();
    await act(async () => buttonsByLabel("ลบรูป")[0].click());
    expect(images).toEqual(["a", "b"]);
    const confirm = [...document.querySelectorAll("button")].find((b) => b.textContent === "ลบรูป");
    await act(async () => confirm?.click());
    expect(images).toEqual(["b"]);
  });
});
