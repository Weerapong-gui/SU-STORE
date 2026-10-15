import { describe, expect, it } from "vitest";
import { isCategoryPath } from "@/lib/storePaths";

describe("isCategoryPath", () => {
  it("matches category pages only", () => {
    expect(isCategoryPath("/products/c/accessories")).toBe(true);
    expect(isCategoryPath("/products/c/accessories/")).toBe(true);
    expect(isCategoryPath("/products/keychain")).toBe(false);
    expect(isCategoryPath("/products/c")).toBe(false);
  });
});
