import { NextResponse } from "next/server";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import {
  attachSlipToOrder,
  getPaymentSlipUploadAvailability,
  setOrderResponseCookie,
  SlipUploadError,
  validateSlipUpload
} from "@/lib/orderStore";
import { getRateLimitKey, isRateLimited } from "@/lib/rateLimit";

const RATE_LIMIT_MAX = 10;

type PaymentRouteProps = {
  params: {
    orderId: string;
  };
};

export async function POST(request: Request, { params }: PaymentRouteProps) {
  if (isRateLimited(getRateLimitKey(request, "slip"), RATE_LIMIT_MAX)) {
    return NextResponse.json({ message: "อัปโหลดบ่อยเกินไป กรุณารอสักครู่" }, { status: 429 });
  }

  try {
    const formData = await request.formData();
    const slip = formData.get("slip");

    if (!(slip instanceof File)) {
      return NextResponse.json({ message: "กรุณาแนบไฟล์สลิปก่อนส่ง" }, { status: 400 });
    }

    const availability = await getPaymentSlipUploadAvailability();
    if (!availability.enabled) {
      return NextResponse.json(
        { message: availability.message ?? "ไม่สามารถอัปโหลดสลิปได้ในขณะนี้" },
        { status: 503 }
      );
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
      message: `บันทึกสลิปของคำสั่งซื้อ ${formatOrderNumber(order)} เรียบร้อย`,
      orderId: order.id
    });

    setOrderResponseCookie(response, order);
    return response;
  } catch (error) {
    console.error("Failed to upload payment slip", error);
    if (error instanceof SlipUploadError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "ไม่สามารถอัปโหลดสลิปได้ในขณะนี้" },
      { status: 500 }
    );
  }
}
