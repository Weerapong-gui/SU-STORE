import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { STORE_PREVIEW_HEADER } from "@/lib/storePreview";
import { forwarded, resetMiddlewareHarness, rewrittenTo, runMiddleware, type RunOptions } from "./helpers/middlewareHarness";

// Here `cookie` is the staff session value, not a raw Cookie header.
const run = (siteClosed: boolean, path: string, { cookie, ...rest }: RunOptions = {}) =>
  runMiddleware(siteClosed, path, { ...rest, cookie: cookie ? `${ADMIN_COOKIE}=${cookie}` : undefined });

const forwardedPreview = (res: Response) => forwarded(res, STORE_PREVIEW_HEADER);

describe("middleware store preview", () => {
  afterEach(resetMiddlewareHarness);

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
