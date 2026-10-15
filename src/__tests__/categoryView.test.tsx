import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/lib/i18n";
import { CategoryView } from "@/components/store/CategoryView";
import type { StoreCategory, StoreProduct, StoreVariant } from "@/types/store";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const category: StoreCategory = {
  id: 1, slug: "keychain", name: "พวงกุญแจ", nameEn: "Keychain", tagline: "", taglineEn: "",
  coverImage: "", visible: true, sortOrder: 0, productCount: 1,
};
const variant = (id: number, code: string, en: string): StoreVariant => ({
  id, size: "", color: "", label: code, price: 79, stock: 3, sku: "", active: true, soldOut: false,
  designCode: code, designName: en, designNameEn: en, image: "", images: [],
});
const product: StoreProduct = {
  id: 1, slug: "keychain", name: "พวงกุญแจ", nameEn: "Keychain", categoryId: 1, optionKind: "designs",
  description: "", images: [], status: "active", buyerFields: [], sortOrder: 0, saleStartsAt: null,
  saleEndsAt: null, saleState: "open", minPrice: 79, maxPrice: 79, soldOut: false,
  variants: [variant(1, "SCS", "Cosmetic Science"), variant(2, "LAW", "Law")], createdAt: "", updatedAt: "",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(products: StoreProduct[]) {
  act(() => root.render(<CategoryView category={category} products={products} />));
}

function type(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CategoryView", () => {
  it("shows the normal empty state and no search for an empty category", () => {
    render([]);
    expect(container.textContent).toContain("No products are on sale right now");
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.textContent).not.toContain("No results");
  });

  it("filters design cards by query", () => {
    render([product]);
    expect(container.querySelectorAll("a[href*='design=']")).toHaveLength(2);
    type("scs");
    const links = container.querySelectorAll("a[href*='design=']");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toContain("design=scs");
  });

  it("shows not-found for no matches and show-all clears the query", () => {
    render([product]);
    type("zzz");
    expect(container.textContent).toContain("No results for “zzz”");
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Show all")!;
    act(() => button.click());
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("");
    expect(container.querySelectorAll("a[href*='design=']")).toHaveLength(2);
  });

  it("links back to the products page in Thai under /th", () => {
    act(() => root.render(<LanguageProvider lang="th"><CategoryView category={category} products={[product]} /></LanguageProvider>));
    expect(container.querySelector('a[href="/th/products"]')).not.toBeNull();
    expect(container.querySelector('a[href="/th/products/keychain?design=scs"]')).not.toBeNull();
  });

  it("renders the cover hero with shade", () => {
    act(() => root.render(<CategoryView category={{ ...category, coverImage: "/product-images/c.png" }} products={[product]} />));
    expect(container.querySelector('section img[src="/product-images/c.png"]')).not.toBeNull();
    expect(container.querySelector(".category-hero-shade")).not.toBeNull();
    expect(container.querySelector("section h1")?.textContent).toBe("Keychain");
    expect(container.querySelector("section")?.textContent).toContain("2 designs in total");
  });

  it("clamps long hero text so it fits the fixed-height cover", () => {
    act(() => root.render(<CategoryView category={{ ...category, coverImage: "/product-images/c.png", tagline: "a\nb\nc", taglineEn: "a\nb\nc" }} products={[product]} />));
    expect(container.querySelector("section h1")?.classList.contains("line-clamp-2")).toBe(true);
    expect(container.querySelector("section h1 + p")?.classList.contains("line-clamp-2")).toBe(true);
    expect(container.querySelector("section h1")?.parentElement?.className).toContain("max-w-");
  });

  it("keeps the plain header without a cover", () => {
    render([product]);
    expect(container.querySelector("section img")).toBeNull();
    expect(container.querySelector(".category-hero-shade")).toBeNull();
    const back = container.querySelector('a[href="/products"]');
    expect(back?.textContent).toContain("‹");
    expect(back?.textContent).toContain("Shop");
    expect(back?.classList.contains("hidden")).toBe(true);
    expect(back?.classList.contains("md:inline-flex")).toBe(true);
  });
});
