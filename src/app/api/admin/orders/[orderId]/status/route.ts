import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

function getAdminToken(): string {
  return cookies().get("su-admin-token")?.value ?? "";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const token = getAdminToken();
  if (!token) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const res = await fetch(
      `${API_BASE}/admin/orders/${encodeURIComponent(params.orderId)}/status`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: "Unable to reach order API" }, { status: 503 });
  }
}
