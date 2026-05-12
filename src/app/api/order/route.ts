import { NextResponse } from "next/server";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { createOrder, setOrderResponseCookie } from "@/lib/orderStore";
import { validateOrderInput } from "@/lib/orderValidation";

export async function POST(request: Request) {
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
      message: order.khantokTicket ? "ได้รับ Khantok ticket" : "สิทธิ์ Khantok ticket เต็มแล้ว",
      orderId: order.id,
      orderNumber: formatOrderNumber(order)
    });

    setOrderResponseCookie(response, order, { accessToken });
    return response;
  } catch (error) {
    console.error("Failed to create order", error);
    return NextResponse.json(
      { success: false, message: "ไม่สามารถสร้างคำสั่งซื้อได้ในขณะนี้" },
      { status: 500 }
    );
  }
}
