import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

function getAdminToken(): string {
  return cookies().get("su-admin-token")?.value ?? "";
}

export async function GET(request: NextRequest) {
  const token = getAdminToken();
  if (!token) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();

  try {
    const res = await fetch(`${API_BASE}/admin/orders${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: "Unable to reach order API" }, { status: 503 });
  }
}
