import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

export const dynamic = "force-dynamic";

// Public storefront calls: /api/store/<path> → order-api /v2/<path>. Admin routes are
// not reachable through here (they go through /api/admin/v2 with a staff session).
async function forward(request: NextRequest, { params }: { params: { path: string[] } }) {
  if (params.path[0] === "admin") {
    return NextResponse.json({ message: "not found" }, { status: 404 });
  }
  const target = `${API_BASE}/v2/${params.path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "x-order-token"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  try {
    const res = await fetch(target, { method: request.method, headers, body, cache: "no-store" });
    return new NextResponse(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ message: "Unable to reach the store service" }, { status: 503 });
  }
}

export { forward as GET, forward as POST };
