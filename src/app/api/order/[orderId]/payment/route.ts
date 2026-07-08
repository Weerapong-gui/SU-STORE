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
    return NextResponse.json({ message: "Too many uploads. Please wait a moment." }, { status: 429 });
  }

  try {
    const formData = await request.formData();
    const slip = formData.get("slip");

    if (!(slip instanceof File)) {
      return NextResponse.json({ message: "Please attach a slip file before submitting" }, { status: 400 });
    }

    const availability = await getPaymentSlipUploadAvailability();
    if (!availability.enabled) {
      return NextResponse.json(
        { message: availability.message ?? "Slip upload is not available right now" },
        { status: 503 }
      );
    }

    const validation = validateSlipUpload(slip);
    if (validation.message) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    const order = await attachSlipToOrder(params.orderId, slip);
    if (!order) {
      return NextResponse.json({ message: "Order not found" }, { status: 404 });
    }

    const response = NextResponse.json({
      message: `Slip saved for order ${formatOrderNumber(order)}`,
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
      { message: "Unable to upload slip at this time" },
      { status: 500 }
    );
  }
}
