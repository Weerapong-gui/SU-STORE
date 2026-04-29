import { NextResponse } from "next/server";
import { createOrder } from "@/lib/orderStore";
import { validateOrderInput } from "@/lib/orderValidation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validation = validateOrderInput(body);

    if (!validation.data) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const order = await createOrder(validation.data);

    return NextResponse.json({
      message: `สร้างคำสั่งซื้อเรียบร้อย หมายเลขออเดอร์ ${order.id}`,
      orderId: order.id
    });
  } catch {
    return NextResponse.json(
      { message: "ไม่สามารถสร้างคำสั่งซื้อได้ในขณะนี้" },
      { status: 500 }
    );
  }
}
