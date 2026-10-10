import { describe, it, expect } from "vitest";
import { accentVars, contrastWithWhite, DEFAULT_ACCENT } from "@/lib/accent";

describe("accentVars", () => {
  it("returns RGB channels for the accent and derived shades", () => {
    const vars = accentVars("#15803d");
    expect(vars["--accent"]).toBe("21 128 61");
    expect(vars["--accent-dark"]).toBe("16 100 48");
    expect(vars["--accent-soft"]).toBe("232 242 236");
  });

  it("falls back to the default accent for bad input", () => {
    expect(accentVars("not-a-colour")).toEqual(accentVars(DEFAULT_ACCENT));
    expect(accentVars(undefined)["--accent"]).toBe("0 113 227");
  });
});

describe("contrastWithWhite", () => {
  it("matches the server's 4.5 threshold", () => {
    expect(contrastWithWhite("#0071e3")).toBeGreaterThan(4.5);
    expect(contrastWithWhite("#ffeb3b")).toBeLessThan(4.5);
    expect(contrastWithWhite("bad")).toBe(0);
  });
});
