import { describe, it, expect } from "vitest";
import { formatPrice } from "@/lib/formatPrice";

describe("formatPrice", () => {
  it("formats whole numbers in THB", () => {
    const result = formatPrice(500);
    expect(result).toContain("500");
    expect(result).toMatch(/฿|THB/);
  });

  it("formats zero", () => {
    const result = formatPrice(0);
    expect(result).toContain("0");
  });

  it("rounds to no decimal places", () => {
    const result = formatPrice(158.5);
    expect(result).not.toContain(".");
  });

  it("formats large amounts", () => {
    const result = formatPrice(1685);
    expect(result).toContain("1,685");
  });
});
