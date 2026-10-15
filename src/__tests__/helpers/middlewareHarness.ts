// Shared setup for middleware tests (not a test file: vitest only collects *.test.*).
import { NextRequest } from "next/server";
import { vi } from "vitest";

const API = "http://order-api:10000";

export type RunOptions = { cookie?: string; method?: string; headers?: Record<string, string> };

// Fakes the order-api: the store is open or closed, and only "Claim good" is a staff session.
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

/** Loads a fresh copy of the middleware; reuse the returned runner to keep module state (rate limits) across calls. */
export async function loadMiddleware(siteClosed: boolean) {
  vi.resetModules();
  vi.stubEnv("ORDER_API_BASE_URL", API);
  vi.stubGlobal("fetch", fakeOrderApi(siteClosed));
  const { middleware } = await import("@/middleware");
  return (path: string, { cookie, method = "GET", headers = {} }: RunOptions = {}) => {
    const all = { ...headers, cookie: cookie ? `${cookie}; su_vid=v` : "su_vid=v" };
    return middleware(new NextRequest(`https://sumfu.store${path}`, { method, headers: all }));
  };
}

/** Runs a fresh copy of the middleware; `cookie` is a raw Cookie header value. */
export async function runMiddleware(siteClosed: boolean, path: string, options: RunOptions = {}) {
  return (await loadMiddleware(siteClosed))(path, options);
}

export function resetMiddlewareHarness(): void {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
}

export const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite") ?? "";
export const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
