import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuyButton } from "@/components/BuyButton";
import { LanguageProvider } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function hrefFor(lang: "en" | "th", href: string): string | null {
  act(() => root.render(<LanguageProvider lang={lang}><BuyButton href={href}>Go</BuyButton></LanguageProvider>));
  return container.querySelector("a")!.getAttribute("href");
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BuyButton href", () => {
  it("does not double the Thai prefix on staff-entered links", () => {
    expect(hrefFor("th", "/th/products/x")).toBe("/th/products/x");
    expect(hrefFor("th", "/th")).toBe("/th");
    expect(hrefFor("en", "/th/products/x")).toBe("/products/x");
  });
  it("localizes plain storefront links and leaves others alone", () => {
    expect(hrefFor("th", "/products/x")).toBe("/th/products/x");
    expect(hrefFor("th", "/admin/orders")).toBe("/admin/orders");
    expect(hrefFor("th", "https://example.com")).toBe("https://example.com");
  });
});
