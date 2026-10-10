import { NextRequest, NextResponse } from "next/server";
import { getRateLimitKey, isRateLimited } from "@/lib/rateLimit";
import { ORDER_API_BASE } from "@/lib/orderApi";

// This proxy is unauthenticated and returns customer name/school by student code, so
// throttle it to blunt PII enumeration over sequential/prefixed student codes.
const RATE_LIMIT_MAX = 20;

export async function GET(request: NextRequest) {
  if (isRateLimited(getRateLimitKey(request, "check-order"), RATE_LIMIT_MAX)) {
    return NextResponse.json({ message: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const studentCode = searchParams.get("studentCode");

  if (!code && !studentCode) {
    return NextResponse.json({ message: "code หรือ studentCode is required" }, { status: 400 });
  }

  const param = code ? `code=${encodeURIComponent(code)}` : `studentCode=${encodeURIComponent(studentCode!)}`;

  try {
    const res = await fetch(`${ORDER_API_BASE}/check-order?${param}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: "ไม่สามารถเชื่อมต่อ order API ได้" }, { status: 503 });
  }
}
