import { describe, it, expect, vi } from "vitest";

// Mock fs to avoid file I/O during tests
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => { throw new Error("no file"); }),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

// Re-import after mock to get fresh module state
const { isRateLimited, getRateLimitKey } = await import("@/lib/rateLimit");

describe("isRateLimited", () => {
  it("allows requests under the limit", () => {
    expect(isRateLimited("test-ip-1", 3)).toBe(false);
    expect(isRateLimited("test-ip-1", 3)).toBe(false);
    expect(isRateLimited("test-ip-1", 3)).toBe(false);
  });

  it("blocks after exceeding limit", () => {
    isRateLimited("test-ip-2", 2);
    isRateLimited("test-ip-2", 2);
    expect(isRateLimited("test-ip-2", 2)).toBe(true);
  });

  it("treats different keys independently", () => {
    isRateLimited("ip-a", 1);
    expect(isRateLimited("ip-a", 1)).toBe(true);
    expect(isRateLimited("ip-b", 1)).toBe(false);
  });
});

describe("getRateLimitKey", () => {
  it("takes the proxy-appended (last) x-forwarded-for entry", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getRateLimitKey(req)).toBe("5.6.7.8");
  });

  it("appends suffix when provided", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getRateLimitKey(req, "order")).toBe("9.9.9.9:order");
  });

  it("falls back to unknown when no IP header", () => {
    const req = new Request("http://localhost");
    expect(getRateLimitKey(req)).toBe("unknown");
  });
});
