import { NextResponse } from "next/server";
import { attachSlipToOrder, setOrderResponseCookie, validateSlipUpload } from "@/lib/orderStore";

type PaymentRouteProps = {
  params: {
    orderId: string;
  };
};

export async function POST(request: Request, { params }: PaymentRouteProps) {
  try {
    const formData = await request.formData();
    const slip = formData.get("slip");

    if (!(slip instanceof File)) {
      return NextResponse.json({ message: "กรุณาแนบไฟล์สลิปก่อนส่ง" }, { status: 400 });
    }

    const validation = validateSlipUpload(slip);
    if (validation.message) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const order = await attachSlipToOrder(params.orderId, slip);
    if (!order) {
      return NextResponse.json({ message: "ไม่พบคำสั่งซื้อ" }, { status: 404 });
    }

    const response = NextResponse.json({
      message: `บันทึกสลิปของคำสั่งซื้อ ${order.id} เรียบร้อย`,
      orderId: order.id
    });

    setOrderResponseCookie(response, order);
    return response;
  } catch (error) {
    console.error("Failed to upload payment slip", error);
    return NextResponse.json(
      { message: "ไม่สามารถอัปโหลดสลิปได้ในขณะนี้" },
      { status: 500 }
    );
  }
}
