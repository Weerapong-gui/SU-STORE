import { NextResponse } from "next/server";
import { getRateLimitKey, isRateLimited } from "@/lib/rateLimit";
import { ORDER_API_BASE } from "@/lib/orderApi";

const REMOTE_ORDER_API_TOKEN = process.env.ORDER_API_TOKEN ?? "";
const RATE_LIMIT_MAX = 5;

type Props = { params: { orderId: string } };

export async function POST(request: Request, { params }: Props) {
  if (isRateLimited(getRateLimitKey(request, "feedback"), RATE_LIMIT_MAX)) {
    return NextResponse.json({ message: "Too many requests. Please wait a moment." }, { status: 429 });
  }
  if (!ORDER_API_BASE) {
    return NextResponse.json({ message: "Order API not configured" }, { status: 503 });
  }

  const orderId = params.orderId.trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(orderId)) {
    return NextResponse.json({ message: "invalid order id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "invalid payload" }, { status: 400 });
  }
  const rating = Number((body as { rating?: unknown }).rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ message: "rating must be 1-5" }, { status: 400 });
  }
  const rawComment = (body as { comment?: unknown }).comment;
  const comment = typeof rawComment === "string" ? rawComment.slice(0, 500) : "";

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (REMOTE_ORDER_API_TOKEN) headers["Authorization"] = `Bearer ${REMOTE_ORDER_API_TOKEN}`;
    const res = await fetch(`${ORDER_API_BASE}/orders/${encodeURIComponent(orderId)}/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rating, comment }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("feedback proxy failed", err);
    return NextResponse.json({ message: "Unable to submit feedback" }, { status: 502 });
  }
}
