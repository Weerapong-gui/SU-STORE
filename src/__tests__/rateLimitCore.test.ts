import { describe, it, expect } from "vitest";
import { RATE_LIMIT_WINDOW_MS, consume, type RateLimitStore } from "@/lib/rateLimitCore";

describe("consume", () => {
  it("allows max requests per window, then limits", () => {
    const store: RateLimitStore = {};
    for (let i = 0; i < 3; i++) expect(consume(store, "ip", 3, 1000)).toBe("counted");
    expect(consume(store, "ip", 3, 1000)).toBe("limited");
  });

  it("starts a new window after it expires and drops expired keys", () => {
    const store: RateLimitStore = {};
    consume(store, "old", 1, 0);
    consume(store, "ip", 1, 0);
    expect(consume(store, "ip", 1, 10)).toBe("limited");
    expect(consume(store, "ip", 1, RATE_LIMIT_WINDOW_MS + 1)).toBe("counted");
    expect(store.old).toBeUndefined();
  });
});
