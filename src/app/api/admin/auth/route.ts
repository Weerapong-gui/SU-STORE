import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/adminAuth";

const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

// Staff sign in with their admin_users username/password; the order-api returns a
// per-user token which we keep in an httpOnly cookie as the Authorization header value.
export async function POST(request: NextRequest) {
  const { username, password } = (await request.json()) as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    return NextResponse.json({ message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" }, { status: 400 });
  }

  let data: { token?: string; username?: string; message?: string };
  let status: number;
  try {
    const res = await fetch(`${API_BASE}/v2/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
      cache: "no-store",
    });
    status = res.status;
    data = await res.json();
  } catch {
    return NextResponse.json({ message: "ติดต่อระบบหลังบ้านไม่ได้ ลองใหม่อีกครั้ง" }, { status: 503 });
  }
  if (status !== 200 || !data.token) {
    return NextResponse.json({ message: data.message ?? "เข้าสู่ระบบไม่สำเร็จ" }, { status: status === 200 ? 500 : status });
  }

  const response = NextResponse.json({ ok: true, username: data.username });
  response.cookies.set(ADMIN_COOKIE, `Claim ${data.token}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_COOKIE);
  return response;
}
