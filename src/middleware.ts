import { NextRequest, NextResponse } from "next/server";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

export function middleware(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.next();
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
    if (entry.count > MAX_REQUESTS) {
      return NextResponse.json(
        { success: false, message: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/order"
};
