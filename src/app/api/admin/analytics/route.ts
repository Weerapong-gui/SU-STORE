import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function GET() {
  const token = cookies().get("su-admin-token")?.value ?? "";
  if (!token) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    const res = await fetch(`${API_BASE}/admin/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: "Unable to reach order API" }, { status: 503 });
  }
}
