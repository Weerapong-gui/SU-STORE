import { NextResponse } from "next/server";

const REQUIRED_FIELDS = ["name", "phone", "product", "address"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, string>;

    const missing = REQUIRED_FIELDS.find((field) => {
      const value = body[field];
      return typeof value !== "string" || !value.trim();
    });

    if (missing) {
      return NextResponse.json(
        { message: `กรุณากรอกข้อมูลให้ครบ: ${missing}` },
        { status: 400 }
      );
    }

    const orderId = `SU-${Date.now()}`;

    return NextResponse.json({
      message: `รับคำสั่งซื้อเรียบร้อย หมายเลขออเดอร์ ${orderId}`,
      orderId
    });
  } catch {
    return NextResponse.json(
      { message: "รูปแบบข้อมูลไม่ถูกต้อง" },
      { status: 400 }
    );
  }
}
