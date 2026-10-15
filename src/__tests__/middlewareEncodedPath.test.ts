import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { loadMiddleware, resetMiddlewareHarness, rewrittenTo, runMiddleware } from "./helpers/middlewareHarness";

// Next decodes the path before matching routes, so the middleware must judge the same decoded path.
describe("middleware with percent-encoded paths", () => {
  afterEach(resetMiddlewareHarness);

  it("rate-limits an encoded order path", async () => {
    const run = await loadMiddleware(false);
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await run("/api/store/%6Frders", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } });
    }
    expect(last?.status).toBe(429);
  });

  it("blocks staff orders on an encoded path while the store is closed", async () => {
    const res = await runMiddleware(true, "/api/store/%6Frders", { method: "POST", cookie: `${ADMIN_COOKIE}=Claim good` });
    expect(res.status).toBe(403);
  });

  it("sends an encoded admin path to the login page", async () => {
    const res = await runMiddleware(false, "/%61dmin/dashboard");
    expect(new URL(res.headers.get("location") ?? "", "https://sumfu.store").pathname).toBe("/admin/login");
  });

  it("keeps encoded Thai paths out of the language rewrite for admin", async () => {
    const res = await runMiddleware(false, "/th/%61dmin/dashboard", { headers: { "accept-language": "th" } });
    expect(rewrittenTo(res)).not.toContain("/admin");
  });

  it("rejects a malformed encoding", async () => {
    expect((await runMiddleware(false, "/products/%E0%A4%A")).status).toBe(400);
  });
});
