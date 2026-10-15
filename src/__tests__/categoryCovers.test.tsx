import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryCovers } from "@/components/store/CategoryCovers";
import type { StoreCategory } from "@/types/store";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const category = (coverImage: string): StoreCategory => ({
  id: 1, slug: "keychain", name: "พวงกุญแจ", nameEn: "Keychain", tagline: "", taglineEn: "",
  coverImage, visible: true, sortOrder: 0, productCount: 1,
});

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

describe("CategoryCovers title band", () => {
  it("blurs the cover photo behind the title when a cover exists", () => {
    act(() => root.render(<CategoryCovers categories={[category("/cover.jpg")]} />));
    const blur = container.querySelector('a img[aria-hidden="true"]');
    expect(blur?.className).toContain("blur-2xl");
    expect(container.querySelector("a")?.className).not.toContain("bg-mist");
  });

  it("keeps the grey band when there is no cover", () => {
    act(() => root.render(<CategoryCovers categories={[category("")]} />));
    expect(container.querySelector('a img[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector("a")?.className).toContain("bg-mist");
  });
});
