import { NextRequest, NextResponse } from "next/server";
import { ORDER_API_BASE } from "@/lib/orderApi";

export const dynamic = "force-dynamic";

// Largest thing a customer sends is a slip (5MB) plus multipart overhead.
const MAX_BODY_BYTES = 6 * 1024 * 1024;

// Public storefront calls: /api/store/<path> → order-api /v2/<path>. Admin routes are
// not reachable through here (they go through /api/admin/v2 with a staff session).
async function forward(request: NextRequest, { params }: { params: { path: string[] } }) {
  if (params.path[0] === "admin" || params.path.some((seg) => seg === "." || seg === "..")) {
    return NextResponse.json({ message: "not found" }, { status: 404 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ message: "ไฟล์ใหญ่เกินไป" }, { status: 413 });
  }
  const target = `${ORDER_API_BASE}/v2/${params.path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
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
