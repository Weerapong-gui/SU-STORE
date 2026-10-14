import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE } from "@/lib/adminAuth";

const API = "http://order-api:10000";

// ORDER_API_BASE is read at import time, so load the module after setting the env.
async function loadModule() {
  vi.resetModules();
  vi.stubEnv("ORDER_API_BASE_URL", API);
  return import("@/lib/storePreview");
}

function request(cookie?: string) {
  return new NextRequest("https://sumfu.store/", { headers: cookie ? { cookie: `${ADMIN_COOKIE}=${cookie}` } : {} });
}

describe("storeGate", () => {
  let storeGate: Awaited<ReturnType<typeof loadModule>>["storeGate"];
  beforeEach(async () => {
    ({ storeGate } = await loadModule());
  });

  it("lets everyone in while the store is open", () => {
    expect(storeGate({ closed: false, staff: false, pathname: "/" })).toBe("open");
  });

  it("shows customers the closed page", () => {
    expect(storeGate({ closed: true, staff: false, pathname: "/products/shirt" })).toBe("closed");
  });

  it("gives staff a preview of the closed store", () => {
    expect(storeGate({ closed: true, staff: true, pathname: "/" })).toBe("preview");
    expect(storeGate({ closed: true, staff: true, pathname: "/products/shirt" })).toBe("preview");
  });

  it("keeps checkout closed for staff", () => {
    expect(storeGate({ closed: true, staff: true, pathname: "/checkout" })).toBe("closed");
    expect(storeGate({ closed: true, staff: true, pathname: "/checkout/x" })).toBe("closed");
    expect(storeGate({ closed: true, staff: true, pathname: "/checkouts" })).toBe("preview");
  });
});

describe("isStaffSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false without a cookie and never calls the api", async () => {
    const { isStaffSession } = await loadModule();
    const fetcher = vi.fn();
    expect(await isStaffSession(request(), fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks the order-api with the cookie as Authorization", async () => {
    const { isStaffSession } = await loadModule();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await isStaffSession(request("Claim abc"), fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(`${API}/v2/admin/me`, expect.objectContaining({ headers: { Authorization: "Claim abc" } }));
  });

  it("rejects a forged or expired cookie", async () => {
    const { isStaffSession } = await loadModule();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await isStaffSession(request("Claim forged"), fetcher)).toBe(false);
  });

  it("caches the answer per session", async () => {
    const { isStaffSession } = await loadModule();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await isStaffSession(request("Claim abc"), fetcher);
    await isStaffSession(request("Claim abc"), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed and does not cache when the order-api is unreachable", async () => {
    const { isStaffSession } = await loadModule();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await isStaffSession(request("Claim abc"), fetcher)).toBe(false);
    expect(await isStaffSession(request("Claim abc"), fetcher)).toBe(true);
  });
});
