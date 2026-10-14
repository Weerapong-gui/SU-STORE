import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductDetail } from "@/components/store/ProductDetail";
import type { StoreProduct, StoreVariant } from "@/types/store";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/components/CartProvider", () => ({ MAX_ITEM_QUANTITY: 10, useCart: () => ({ addItem: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const variant = (id: number, code: string, name: string, soldOut = false): StoreVariant => ({
  id, size: "", color: "", label: code, price: 79, stock: soldOut ? 0 : 3, sku: "", active: true, soldOut,
  designCode: code, designName: name, designNameEn: name, image: "",
});
const product: StoreProduct = {
  id: 1, slug: "keychain", name: "พวงกุญแจ", nameEn: "Keychain", categoryId: 1, optionKind: "designs",
  description: "", images: [], status: "active", buyerFields: [], sortOrder: 0, saleStartsAt: null,
  saleEndsAt: null, saleState: "open", minPrice: 79, maxPrice: 79, soldOut: false,
  variants: [variant(1, "SCS", "Cosmetic Science"), variant(2, "AI", "Artificial Intelligence"), variant(3, "LAW", "Law", true)],
  createdAt: "", updatedAt: "",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  replace.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ProductDetail product={product} initialDesign="scs" />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const swatch = (code: string) => container.querySelector<HTMLButtonElement>(`[role="radio"][aria-label^="${code} "]`)!;

describe("ProductDetail design picker", () => {
  it("opens on the design from the URL, matched case-insensitively", () => {
    expect(container.querySelector("h1")?.textContent).toBe("Cosmetic Science");
    expect(swatch("SCS").getAttribute("aria-checked")).toBe("true");
  });

  it("puts the chosen design in the URL without scrolling", () => {
    act(() => swatch("AI").click());
    expect(replace).toHaveBeenCalledWith("/products/keychain?design=ai", { scroll: false });
    expect(container.querySelector("h1")?.textContent).toBe("Artificial Intelligence");
  });

  it("disables sold-out designs and says so in the label", () => {
    expect(swatch("LAW").disabled).toBe(true);
    expect(swatch("LAW").getAttribute("aria-label")).toContain("sold out");
  });
});

describe("BuyBar feedback", () => {
  it("shows the choose-an-option notice inside the buy bar", () => {
    const sizeVariant = (id: number, size: string): StoreVariant => ({ ...variant(id, "", ""), size, label: size, designCode: "", designName: "", designNameEn: "" });
    const shirt: StoreProduct = { ...product, optionKind: "options", variants: [sizeVariant(10, "S"), sizeVariant(11, "M")] };
    act(() => root.render(<ProductDetail product={shirt} />));
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "เพิ่มลงตะกร้า" || b.textContent === "Add to cart")!;
    act(() => add.click());
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toMatch(/Please choose an option|กรุณาเลือกตัวเลือกสินค้า/);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.closest(".sticky")).toBe(add.parentElement);
  });
});
