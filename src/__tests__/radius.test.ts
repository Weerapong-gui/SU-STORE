import { describe, expect, it } from "vitest";
import { clampRadius, DEFAULT_RADIUS, radiusVars } from "@/lib/radius";

describe("radiusVars", () => {
  it("keeps the original design at 100", () => {
    expect(radiusVars(100)).toEqual({ "--radius-scale": "1", "--radius-full": "9999px" });
  });

  it("squares everything at 0", () => {
    expect(radiusVars(0)).toEqual({ "--radius-scale": "0", "--radius-full": "0rem" });
  });

  it("scales pills gradually below 100", () => {
    expect(radiusVars(50)).toEqual({ "--radius-scale": "0.5", "--radius-full": "0.75rem" });
  });

  it("falls back to the default for bad values", () => {
    expect(clampRadius(undefined)).toBe(DEFAULT_RADIUS);
    expect(clampRadius(Number.NaN)).toBe(DEFAULT_RADIUS);
    expect(clampRadius(150)).toBe(100);
    expect(clampRadius(-5)).toBe(0);
  });
});
