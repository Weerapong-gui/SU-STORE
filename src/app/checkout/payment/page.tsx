import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import generatePayload from "promptpay-qr";
import { Container } from "@/components/ui/Container";
import { products } from "@/data/products";
import { formatPrice } from "@/lib/formatPrice";

type SearchValue = string | string[] | undefined;

type PaymentPageProps = {
  searchParams?: Record<string, SearchValue>;
};

function readParam(value: SearchValue): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export default async function CheckoutPaymentPage({ searchParams }: PaymentPageProps) {
  const productSlug = readParam(searchParams?.product);
  const product = products.find((item) => item.slug === productSlug) ?? products[0];

  const rawQuantity = readParam(searchParams?.quantity);
  const rawSize = readParam(searchParams?.size);
  const rawFirstName = readParam(searchParams?.firstName);
  const rawLastName = readParam(searchParams?.lastName);
  const rawNickname = readParam(searchParams?.nickname);
  const rawEmail = readParam(searchParams?.email);
  const rawPhone = readParam(searchParams?.phone);
  const rawSchool = readParam(searchParams?.school);

  const quantity = Math.max(1, Number.parseInt(rawQuantity || "1", 10) || 1);
  const size = rawSize || "-";
  const firstName = rawFirstName || "-";
  const lastName = rawLastName || "-";
  const nickname = rawNickname || "-";
  const email = rawEmail || "-";
  const phone = rawPhone || "-";
  const school = rawSchool || "-";

  const total = product.price * quantity;
  const promptPayId = process.env.PROMPTPAY_ID ?? process.env.NEXT_PUBLIC_PROMPTPAY_ID ?? "";

  let qrCodeDataUrl = "";
  if (promptPayId) {
    const payload = generatePayload(promptPayId, { amount: total });
    qrCodeDataUrl = await QRCode.toDataURL(payload, {
      margin: 1,
      width: 520,
      color: {
        dark: "#111111",
        light: "#f5f5f7"
      }
    });
  }

  const params = new URLSearchParams({
    product: product.slug,
    size: rawSize || "M",
    quantity: String(quantity),
    firstName: rawFirstName,
    lastName: rawLastName,
    nickname: rawNickname,
    email: rawEmail,
    phone: rawPhone,
    school: rawSchool
  });

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-5xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">PAYMENT</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            สแกน QR เพื่อชำระเงิน
          </h1>
          <p className="mt-2 text-sm text-zinc-600">ระบบล็อกยอดชำระตามคำสั่งซื้อของคุณอัตโนมัติ</p>

          <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-3xl border border-zinc-300 bg-white p-5">
              {qrCodeDataUrl ? (
                <Image
                  src={qrCodeDataUrl}
                  alt={`PromptPay QR for ${formatPrice(total)}`}
                  width={280}
                  height={280}
                  unoptimized
                  className="mx-auto w-full max-w-[280px] rounded-2xl"
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
                  ยังไม่พบ PromptPay ID
                  <br />
                  กรุณาตั้งค่า <code className="rounded bg-zinc-200 px-1">PROMPTPAY_ID</code> ใน
                  <code className="ml-1 rounded bg-zinc-200 px-1">.env.local</code>
                </div>
              )}

              <div className="mt-5 rounded-2xl border border-zinc-200 bg-[#f7f7f9] p-4">
                <p className="text-xs font-semibold tracking-[0.08em] text-zinc-500">TOTAL AMOUNT</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900">{formatPrice(total)}</p>
                <p className="mt-2 text-xs text-zinc-500">ยอดนี้ถูกล็อกตามจำนวนสินค้าและจำนวนชิ้นที่เลือก</p>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-300 bg-white p-5">
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER SUMMARY</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900">{product.name}</h2>
              <p className="mt-1 text-sm text-zinc-600">{product.tagline}</p>

              <div className="mt-4 space-y-2 text-sm text-zinc-700">
                <p>Size: {size}</p>
                <p>Quantity: {quantity}</p>
                <p>Unit Price: {formatPrice(product.price)}</p>
                <p className="font-semibold text-zinc-900">Total: {formatPrice(total)}</p>
              </div>

              <div className="mt-5 border-t border-zinc-200 pt-4 text-sm text-zinc-700">
                <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CUSTOMER</p>
                <p className="mt-2">Name: {firstName} {lastName}</p>
                <p>Nickname: {nickname}</p>
                <p>Email: {email}</p>
                <p>Phone: {phone}</p>
                <p>School: {school}</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={`/checkout/summary?${params.toString()}`}
                  className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100"
                >
                  Back to Summary
                </Link>
                <Link
                  href={`/checkout?${params.toString()}`}
                  className="inline-flex items-center justify-center rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
                >
                  Edit Order
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
