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

const INFO_CARD_CLASSES = "rounded-3xl border border-zinc-300 bg-white p-5";
const SECONDARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-5 py-2.5 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";
const PRIMARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";

function readSearchParam(value: SearchValue): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export default async function CheckoutPaymentPage({ searchParams }: PaymentPageProps) {
  const selectedProductSlug = readSearchParam(searchParams?.product);
  const selectedProduct = products.find((product) => product.slug === selectedProductSlug) ?? products[0];

  const quantityParam = readSearchParam(searchParams?.quantity);
  const sizeParam = readSearchParam(searchParams?.size);
  const firstNameParam = readSearchParam(searchParams?.firstName);
  const lastNameParam = readSearchParam(searchParams?.lastName);
  const nicknameParam = readSearchParam(searchParams?.nickname);
  const emailParam = readSearchParam(searchParams?.email);
  const phoneParam = readSearchParam(searchParams?.phone);
  const schoolParam = readSearchParam(searchParams?.school);

  const quantity = Math.max(1, Number.parseInt(quantityParam || "1", 10) || 1);
  const selectedSize = sizeParam || "-";
  const firstName = firstNameParam || "-";
  const lastName = lastNameParam || "-";
  const nickname = nicknameParam || "-";
  const email = emailParam || "-";
  const phone = phoneParam || "-";
  const school = schoolParam || "-";

  const totalAmount = selectedProduct.price * quantity;
  const promptPayId = process.env.PROMPTPAY_ID ?? process.env.NEXT_PUBLIC_PROMPTPAY_ID ?? "";

  let promptPayQrCodeDataUrl = "";
  if (promptPayId) {
    const promptPayPayload = generatePayload(promptPayId, { amount: totalAmount });
    promptPayQrCodeDataUrl = await QRCode.toDataURL(promptPayPayload, {
      margin: 1,
      width: 520,
      color: {
        dark: "#111111",
        light: "#f5f5f7"
      }
    });
  }

  const checkoutSearchParams = new URLSearchParams({
    product: selectedProduct.slug,
    size: sizeParam || "M",
    quantity: String(quantity),
    firstName: firstNameParam,
    lastName: lastNameParam,
    nickname: nicknameParam,
    email: emailParam,
    phone: phoneParam,
    school: schoolParam
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
            <div className={INFO_CARD_CLASSES}>
              {promptPayQrCodeDataUrl ? (
                <Image
                  src={promptPayQrCodeDataUrl}
                  alt={`PromptPay QR for ${formatPrice(totalAmount)}`}
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
                <p className="mt-1 text-3xl font-semibold tracking-tight text-apple-blue">
                  {formatPrice(totalAmount)}
                </p>
                <p className="mt-2 text-xs text-zinc-500">ยอดนี้ถูกล็อกตามจำนวนสินค้าและจำนวนชิ้นที่เลือก</p>
              </div>
            </div>

            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER SUMMARY</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900">{selectedProduct.name}</h2>
              <p className="mt-1 text-sm text-zinc-600">{selectedProduct.tagline}</p>

              <div className="mt-4 space-y-2 text-sm text-zinc-700">
                <p>Size: {selectedSize}</p>
                <p>Quantity: {quantity}</p>
                <p>
                  Unit Price:{" "}
                  <span className="font-semibold text-apple-blue">
                    {formatPrice(selectedProduct.price)}
                  </span>
                </p>
                <p className="font-semibold text-zinc-900">
                  Total: <span className="text-apple-blue">{formatPrice(totalAmount)}</span>
                </p>
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
                  href={`/checkout/summary?${checkoutSearchParams.toString()}`}
                  className={SECONDARY_ACTION_LINK_CLASSES}
                >
                  Back to Summary
                </Link>
                <Link
                  href={`/checkout?${checkoutSearchParams.toString()}`}
                  className={PRIMARY_ACTION_LINK_CLASSES}
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
