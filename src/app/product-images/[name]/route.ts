import { NextResponse } from "next/server";
import { ORDER_API_BASE } from "@/lib/orderApi";

// Product photos uploaded through the admin live on the order-api; serve them from the
// store's own origin so pages can use the stored "/product-images/<file>" paths as-is.
export async function GET(_request: Request, { params }: { params: { name: string } }) {
  if (!/^[a-zA-Z0-9._-]+$/.test(params.name)) {
    return NextResponse.json({ message: "invalid filename" }, { status: 400 });
  }
  try {
    const res = await fetch(`${ORDER_API_BASE}/product-images/${params.name}`, { cache: "no-store" });
    if (!res.ok) return new NextResponse(null, { status: res.status });
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
