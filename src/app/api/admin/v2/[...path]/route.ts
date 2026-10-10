import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { ORDER_API_BASE } from "@/lib/orderApi";

export const dynamic = "force-dynamic";

// Forwards /api/admin/v2/<path> to the order-api's /v2/admin/<path>, attaching the
// staff session from the httpOnly cookie. Bodies (JSON or multipart) and responses
// (JSON, CSV, slip images) pass through untouched.
async function forward(request: NextRequest, { params }: { params: { path: string[] } }) {
  const auth = cookies().get(ADMIN_COOKIE)?.value;
  if (!auth) return NextResponse.json({ message: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const target = `${ORDER_API_BASE}/v2/admin/${params.path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  const headers: Record<string, string> = { Authorization: auth };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();

  let res: Response;
  try {
    res = await fetch(target, { method: request.method, headers, body, cache: "no-store" });
  } catch {
    return NextResponse.json({ message: "ติดต่อระบบหลังบ้านไม่ได้ ลองใหม่อีกครั้ง" }, { status: 503 });
  }

  const passHeaders = new Headers();
  for (const name of ["content-type", "content-disposition"]) {
    const value = res.headers.get(name);
    if (value) passHeaders.set(name, value);
  }
  const response = new NextResponse(res.body, { status: res.status, headers: passHeaders });
  if (res.status === 401) response.cookies.delete(ADMIN_COOKIE);
  return response;
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
