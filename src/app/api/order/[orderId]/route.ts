import { NextResponse } from "next/server";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { getOrderById, setOrderResponseCookie, updateOrder } from "@/lib/orderStore";
import { validateOrderInput } from "@/lib/orderValidation";
import { getRateLimitKey, isRateLimited } from "@/lib/rateLimit";

const MAX_BODY_BYTES = 100 * 1024;
const RATE_LIMIT_MAX = 10;

type OrderRouteProps = {
  params: {
    orderId: string;
  };
};

export async function GET(_: Request, { params }: OrderRouteProps) {
  try {
    const order = await getOrderById(params.orderId);

    if (!order) {
      return NextResponse.json({ message: "ไม่พบคำสั่งซื้อ" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error("Failed to load order", error);
    return NextResponse.json(
      { message: "ไม่สามารถโหลดคำสั่งซื้อได้ในขณะนี้" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: OrderRouteProps) {
  if (isRateLimited(getRateLimitKey(request, "order-update"), RATE_LIMIT_MAX)) {
    return NextResponse.json({ message: "ส่งคำสั่งซื้อบ่อยเกินไป กรุณารอสักครู่" }, { status: 429 });
  }

  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ message: "Request body ใหญ่เกินไป" }, { status: 413 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validation = validateOrderInput(body);

    if (!validation.data) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const order = await updateOrder(params.orderId, validation.data);

    if (!order) {
      return NextResponse.json({ message: "ไม่พบคำสั่งซื้อที่ต้องการแก้ไข" }, { status: 404 });
    }

    const response = NextResponse.json({
      message: `อัปเดตคำสั่งซื้อ ${formatOrderNumber(order)} เรียบร้อย`,
      orderId: order.id
    });

    setOrderResponseCookie(response, order);
    return response;
  } catch (error) {
    console.error("Failed to update order", error);
    return NextResponse.json(
      { message: "ไม่สามารถอัปเดตคำสั่งซื้อได้ในขณะนี้" },
      { status: 500 }
    );
  }
}
