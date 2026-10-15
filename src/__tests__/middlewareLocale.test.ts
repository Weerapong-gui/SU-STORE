import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { LANG_HEADER, PATH_HEADER } from "@/lib/locale";
import { forwarded, resetMiddlewareHarness, rewrittenTo, runMiddleware as run } from "./helpers/middlewareHarness";

const locationOf = (res: Response) => new URL(res.headers.get("location") ?? "");
const thaiPhone = { "accept-language": "th-TH", "user-agent": "Mozilla/5.0 (iPhone) Safari" };
const englishMac = { "accept-language": "en-US", "user-agent": "Mozilla/5.0 (Macintosh) Safari" };

describe("middleware locale routing", () => {
  afterEach(resetMiddlewareHarness);

  it("serves Thai paths from the shared pages", async () => {
    const res = await run(false, "/th/products/x", { headers: englishMac, cookie: "su_lang=th" });
    expect(new URL(rewrittenTo(res)).pathname).toBe("/products/x");
    expect(forwarded(res, LANG_HEADER)).toBe("th");
    expect(forwarded(res, PATH_HEADER)).toBe("/products/x");
  });

  it("keeps the order token across a language redirect", async () => {
    const res = await run(false, "/order/SU0001?t=abc", { headers: englishMac, cookie: "su_lang=th" });
    expect(res.status).toBe(307);
    expect(locationOf(res).pathname + locationOf(res).search).toBe("/th/order/SU0001?t=abc");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe("Cookie, Accept-Language");
  });

  it("sends a Thai device to /th on a first visit", async () => {
    const res = await run(false, "/", { headers: thaiPhone });
    expect(locationOf(res).pathname).toBe("/th");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("su_lang");
  });

  it("sends an English choice back to the unprefixed path", async () => {
    const res = await run(false, "/th/products/x?size=M", { headers: thaiPhone, cookie: "su_lang=en" });
    expect(res.status).toBe(307);
    expect(locationOf(res).pathname + locationOf(res).search).toBe("/products/x?size=M");
  });

  it("never redirects bots", async () => {
    const res = await run(false, "/products/x", { headers: { "accept-language": "th", "user-agent": "facebookexternalhit/1.1" } });
    expect(res.status).not.toBe(307);
  });

  it("drops client-sent language headers", async () => {
    const res = await run(false, "/products/x", { headers: { ...englishMac, [LANG_HEADER]: "th", [PATH_HEADER]: "/evil" } });
    expect(forwarded(res, LANG_HEADER)).toBe("en");
    expect(forwarded(res, PATH_HEADER)).toBe("/products/x");
  });

  it("keeps Thai checkout closed for staff", async () => {
    const res = await run(true, "/th/checkout", { headers: thaiPhone, cookie: `${ADMIN_COOKIE}=Claim good` });
    expect(rewrittenTo(res)).toContain("/maintenance");
    expect(forwarded(res, LANG_HEADER)).toBe("th");
  });

  it("rewrites Thai paths on always-open hosts", async () => {
    vi.stubEnv("ALWAYS_OPEN", "1");
    const res = await run(false, "/th/products/x", { headers: thaiPhone });
    expect(new URL(rewrittenTo(res)).pathname).toBe("/products/x");
  });

  it("leaves admin and api routes alone", async () => {
    expect((await run(false, "/admin/login", { headers: thaiPhone })).status).not.toBe(307);
    expect((await run(false, "/api/store/products", { headers: thaiPhone })).status).not.toBe(307);
  });

  it("serves Thai paths to HEAD requests", async () => {
    const res = await run(false, "/th/products/x", { method: "HEAD", headers: thaiPhone });
    expect(new URL(rewrittenTo(res)).pathname).toBe("/products/x");
    expect(forwarded(res, LANG_HEADER)).toBe("th");
  });

  it("drops client-sent language headers on non-GET page requests", async () => {
    const res = await run(false, "/products/x", { method: "POST", headers: { ...englishMac, [LANG_HEADER]: "th", [PATH_HEADER]: "/evil" } });
    expect(forwarded(res, LANG_HEADER)).toBe("en");
    expect(forwarded(res, PATH_HEADER)).toBe("/products/x");
  });

  it("leaves product images and files alone", async () => {
    expect((await run(false, "/product-images/abc", { headers: thaiPhone })).status).not.toBe(307);
    expect((await run(false, "/robots.txt", { headers: thaiPhone })).status).not.toBe(307);
  });
});
