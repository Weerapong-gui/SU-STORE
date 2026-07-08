import { NextResponse } from "next/server";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { createOrder, setOrderResponseCookie } from "@/lib/orderStore";
import { validateOrderInput } from "@/lib/orderValidation";
import { getRateLimitKey, isRateLimited } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

const MAX_BODY_BYTES = 100 * 1024;
const RATE_LIMIT_MAX = 5;

export async function POST(request: Request) {
  if (isRateLimited(getRateLimitKey(request, "order"), RATE_LIMIT_MAX)) {
    return NextResponse.json({ success: false, message: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, message: "Request body too large" }, { status: 413 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validation = validateOrderInput(body);

    if (!validation.data) {
      return NextResponse.json({ success: false, message: validation.message }, { status: 400 });
    }

    const { order, accessToken } = await createOrder(validation.data);

    const response = NextResponse.json({
      success: true,
      khantokTicket: order.khantokTicket,
      message: order.khantokTicket ? "Khantok ticket received" : "Khantok ticket quota full",
      orderId: order.id,
      orderNumber: formatOrderNumber(order)
    });

    setOrderResponseCookie(response, order, { accessToken });
    return response;
  } catch (error) {
    logger.error("Failed to create order", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
    });
    // Forward the API rejection message (e.g. "สินค้าปิดจำหน่าย") instead of generic 500
    let userMessage = "Unable to create order at this time";
    if (error instanceof Error) {
      const jsonMatch = error.message.match(/:\s*(\{.*\})\s*$/);
      if (jsonMatch) {
        try {
          const body = JSON.parse(jsonMatch[1]) as { message?: string };
          if (typeof body.message === "string") userMessage = body.message;
        } catch { /* keep default */ }
      }
    }
    return NextResponse.json({ success: false, message: userMessage }, { status: 400 });
  }
}
