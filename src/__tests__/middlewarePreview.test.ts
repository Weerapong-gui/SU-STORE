import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { STORE_PREVIEW_HEADER } from "@/lib/storePreview";

const API = "http://order-api:10000";

// Fakes the order-api: the store is closed, and only "Claim good" is a staff session.
function fakeOrderApi(siteClosed: boolean) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith(`${API}/site-status`)) return Response.json({ siteClosed });
    if (url === `${API}/v2/admin/me`) {
      const auth = (init?.headers as Record<string, string>).Authorization;
      return new Response("{}", { status: auth === "Claim good" ? 200 : 401 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function run(siteClosed: boolean, path: string, { cookie, method = "GET", headers = {} }: { cookie?: string; method?: string; headers?: Record<string, string> } = {}) {
  vi.resetModules();
  vi.stubEnv("ORDER_API_BASE_URL", API);
  vi.stubGlobal("fetch", fakeOrderApi(siteClosed));
  const { middleware } = await import("@/middleware");
  const all = { ...headers, ...(cookie ? { cookie: `${ADMIN_COOKIE}=${cookie}; su_vid=v` } : { cookie: "su_vid=v" }) };
  return middleware(new NextRequest(`https://sumfu.store${path}`, { method, headers: all }));
}

const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite") ?? "";
const forwardedPreview = (res: Response) => res.headers.get(`x-middleware-request-${STORE_PREVIEW_HEADER}`);

describe("middleware store preview", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows customers the closed page", async () => {
    expect(rewrittenTo(await run(true, "/"))).toContain("/maintenance?reason=manual");
  });

  it("lets verified staff preview the closed store", async () => {
    const res = await run(true, "/products/shirt", { cookie: "Claim good" });
    expect(rewrittenTo(res)).toBe("");
    expect(forwardedPreview(res)).toBe("1");
  });

  it("treats a forged staff cookie as a customer", async () => {
    expect(rewrittenTo(await run(true, "/", { cookie: "Claim forged" }))).toContain("/maintenance");
  });

  it("keeps checkout closed for staff", async () => {
    expect(rewrittenTo(await run(true, "/checkout", { cookie: "Claim good" }))).toContain("/maintenance");
  });

  it("drops a client-sent preview header", async () => {
    const res = await run(false, "/", { headers: { [STORE_PREVIEW_HEADER]: "1" } });
    expect(forwardedPreview(res)).toBeNull();
  });

  it("blocks staff from creating orders while closed", async () => {
    const res = await run(true, "/api/store/orders", { cookie: "Claim good", method: "POST" });
    expect(res.status).toBe(403);
  });

  it("lets staff order normally while the store is open", async () => {
    const res = await run(false, "/api/store/orders", { cookie: "Claim good", method: "POST" });
    expect(res.status).toBe(200);
  });
});
