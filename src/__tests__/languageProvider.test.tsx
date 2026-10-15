import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyLangMigration } from "@/components/LegacyLangMigration";
import { StoreShell } from "@/components/store/StoreShell";
import { LanguageProvider, useLang, useLocalePath } from "@/lib/i18n";
import { assignLocation, replaceLocation } from "@/lib/navigate";

vi.mock("@/lib/navigate", () => ({ assignLocation: vi.fn(), replaceLocation: vi.fn() }));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/ScheduleWarningBanner", () => ({ ScheduleWarningBanner: () => null }));
vi.mock("@/components/CartProvider", () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY_KEY = "su-store-lang";

// Node 22+ ships its own global `localStorage` (undefined without --localstorage-file),
// which hides jsdom's, so give the tests a plain in-memory Storage.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, String(value)); },
  };
}
vi.stubGlobal("localStorage", memoryStorage());

let container: HTMLDivElement;
let root: Root;

function Probe() {
  const { lang, setLang } = useLang();
  const toLocale = useLocalePath();
  return (
    <button type="button" onClick={() => setLang("th")}>
      {`${lang} ${toLocale("/checkout")}`}
    </button>
  );
}

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  document.cookie = "su_lang=; max-age=0; path=/";
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("LanguageProvider", () => {
  it("uses the language given by the server", () => {
    render(<LanguageProvider lang="th"><Probe /></LanguageProvider>);
    expect(container.textContent).toBe("th /th/checkout");
  });

  it("setLang saves the cookie and opens the same page in the other language", () => {
    window.history.replaceState(null, "", "/order/SU1?t=abc");
    render(<LanguageProvider lang="en"><Probe /></LanguageProvider>);
    act(() => container.querySelector("button")!.click());
    expect(document.cookie).toContain("su_lang=th");
    expect(assignLocation).toHaveBeenCalledWith("/th/order/SU1?t=abc");
  });

  it("StoreShell defaults to English without migrating", () => {
    localStorage.setItem(LEGACY_KEY, "th");
    render(<StoreShell><Probe /></StoreShell>);
    expect(container.textContent).toContain("en");
    expect(localStorage.getItem(LEGACY_KEY)).toBe("th");
    expect(document.cookie).not.toContain("su_lang");
  });
});

describe("LegacyLangMigration", () => {
  it("moves the old choice into the cookie and opens the page in that language", () => {
    localStorage.setItem(LEGACY_KEY, "th");
    window.history.replaceState(null, "", "/products?x=1");
    render(<LegacyLangMigration />);
    expect(document.cookie).toContain("su_lang=th");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(replaceLocation).toHaveBeenCalledWith("/th/products?x=1");
  });

  it("does not navigate when the page is already in the stored language", () => {
    localStorage.setItem(LEGACY_KEY, "th");
    window.history.replaceState(null, "", "/th/products");
    render(<LegacyLangMigration />);
    expect(document.cookie).toContain("su_lang=th");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(replaceLocation).not.toHaveBeenCalled();
  });

  it("leaves an existing cookie choice alone", () => {
    localStorage.setItem(LEGACY_KEY, "th");
    document.cookie = "su_lang=en; path=/";
    render(<LegacyLangMigration />);
    expect(document.cookie).toContain("su_lang=en");
    expect(localStorage.getItem(LEGACY_KEY)).toBe("th");
    expect(replaceLocation).not.toHaveBeenCalled();
  });
});
