import { describe, expect, it } from "vitest";
import { localized } from "@/lib/localized";

describe("localized", () => {
  it("selects English and falls back to Thai", () => {
    expect(localized("พวงกุญแจ", "", "en")).toBe("พวงกุญแจ");
    expect(localized("พวงกุญแจ", "Keychain", "en")).toBe("Keychain");
    expect(localized("พวงกุญแจ", null, "en")).toBe("พวงกุญแจ");
    expect(localized("พวงกุญแจ", undefined, "en")).toBe("พวงกุญแจ");
  });
  it("selects Thai and falls back to English", () => {
    expect(localized("พวงกุญแจ", "Keychain", "th")).toBe("พวงกุญแจ");
    expect(localized("", "Keychain", "th")).toBe("Keychain");
    expect(localized("", "", "th")).toBe("");
  });
});
