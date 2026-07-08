import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function POST(request: NextRequest) {
  const { token } = (await request.json()) as { token?: string };
  if (!token?.trim()) {
    return NextResponse.json({ message: "Token is required" }, { status: 400 });
  }

  // Verify token against order-api
  try {
    const res = await fetch(`${API_BASE}/admin/orders?page=1&per_page=1`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ message: "Invalid token" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ message: "Unable to reach order API" }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("su-admin-token", token, {
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
  response.cookies.delete("su-admin-token");
  return response;
}
