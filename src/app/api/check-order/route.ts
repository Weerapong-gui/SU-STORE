import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const studentCode = searchParams.get("studentCode");

  if (!code && !studentCode) {
    return NextResponse.json({ message: "code หรือ studentCode is required" }, { status: 400 });
  }

  const param = code ? `code=${encodeURIComponent(code)}` : `studentCode=${encodeURIComponent(studentCode!)}`;

  try {
    const res = await fetch(`${API_BASE}/check-order?${param}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: "ไม่สามารถเชื่อมต่อ order API ได้" }, { status: 503 });
  }
}
