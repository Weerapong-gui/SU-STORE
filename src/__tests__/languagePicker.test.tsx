import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguagePicker } from "@/components/LanguagePicker";
import { LanguageProvider } from "@/lib/i18n";
import { assignLocation } from "@/lib/navigate";

const pathnameMock = vi.hoisted(() => ({ value: "/products/x" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock.value }));
vi.mock("@/lib/navigate", () => ({ assignLocation: vi.fn(), replaceLocation: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(lang: "en" | "th") {
  act(() => root.render(<LanguageProvider lang={lang}><LanguagePicker /></LanguageProvider>));
}

beforeEach(() => {
  pathnameMock.value = "/products/x";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.cookie = "su_lang=; max-age=0; path=/";
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("LanguagePicker", () => {
  it("shows the current language and links to the other one", () => {
    render("en");
    expect(container.querySelector('[aria-current="true"]')?.textContent).toBe("English");
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/th/products/x");
    expect(link.textContent).toBe("ไทย");
  });

  it("links back to the English path from a Thai page", () => {
    pathnameMock.value = "/th/products/x";
    render("th");
    expect(container.querySelector('[aria-current="true"]')?.textContent).toBe("ไทย");
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/products/x");
  });

  it("switches language on click", () => {
    window.history.replaceState(null, "", "/products/x");
    render("en");
    act(() => container.querySelector("a")!.click());
    expect(document.cookie).toContain("su_lang=th");
    expect(assignLocation).toHaveBeenCalledWith("/th/products/x");
  });

  it("renders no link inside the admin preview", () => {
    pathnameMock.value = "/admin/home/preview";
    render("en");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector('[aria-current="true"]')?.textContent).toBe("English");
  });
});
