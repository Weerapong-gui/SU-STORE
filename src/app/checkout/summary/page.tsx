import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { products } from "@/data/products";
import { formatPrice } from "@/lib/formatPrice";

type SearchValue = string | string[] | undefined;

type SummaryPageProps = {
  searchParams?: Record<string, SearchValue>;
};

const INFO_CARD_CLASSES = "rounded-3xl border border-zinc-300 bg-white p-5";
const SECONDARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-6 py-3 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";
const PRIMARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-6 py-3 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";

function readSearchParam(value: SearchValue): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export default function CheckoutSummaryPage({ searchParams }: SummaryPageProps) {
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

  const editSearchParams = new URLSearchParams({
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
  const paymentQueryString = editSearchParams.toString();

  const subtotalAmount = selectedProduct.price * quantity;

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-5xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CHECKOUT SUMMARY</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            ตรวจสอบคำสั่งซื้อก่อนยืนยัน
          </h1>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER</p>
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
              </div>
            </div>

            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CUSTOMER</p>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <p>Name: {firstName} {lastName}</p>
                <p>Nickname: {nickname}</p>
                <p>Email: {email}</p>
                <p>Phone: {phone}</p>
                <p>School: {school}</p>
              </div>
            </div>
          </div>

          <div className={`mt-6 ${INFO_CARD_CLASSES}`}>
            <div className="flex items-center justify-between text-sm text-zinc-700">
              <span>Subtotal</span>
              <span className="font-semibold text-apple-blue">{formatPrice(subtotalAmount)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-lg font-semibold text-zinc-900">
              <span>Total</span>
              <span className="text-apple-blue">{formatPrice(subtotalAmount)}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/checkout?${editSearchParams.toString()}`}
              className={SECONDARY_ACTION_LINK_CLASSES}
            >
              Back to Edit
            </Link>
            <Link
              href={`/checkout/payment?${paymentQueryString}`}
              className={PRIMARY_ACTION_LINK_CLASSES}
            >
              Ready to Confirm
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
