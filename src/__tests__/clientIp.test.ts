import { describe, it, expect } from "vitest";
import { clientIp } from "@/lib/clientIp";

const req = (headers: Record<string, string>) => new Request("http://x/", { headers });

describe("clientIp", () => {
  it("prefers cf-connecting-ip", () => {
    expect(clientIp(req({ "cf-connecting-ip": "5.5.5.5", "x-forwarded-for": "1.2.3.4" }))).toBe("5.5.5.5");
  });
  it("uses the last x-forwarded-for entry, not the client-supplied first one", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("9.9.9.9");
  });
  it("falls back to unknown", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });
});
