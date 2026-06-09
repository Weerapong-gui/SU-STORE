import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/ProductConfigurator";
import { Container } from "@/components/ui/Container";
import { getProductBySlug } from "@/data/products";
import { getProducts } from "@/lib/getProducts";
import { normalizeConfigureIntent } from "@/lib/cart";

export const dynamic = "force-dynamic";

type ProductConfigurePageProps = {
  params: {
    slug: string;
  };
  searchParams?: {
    intent?: string;
    itemId?: string;
    size?: string;
    quantity?: string;
    school?: string;
  };
};

export default async function ProductConfigurePage({
  params,
  searchParams
}: ProductConfigurePageProps) {
  const product = getProductBySlug(params.slug);

  if (!product) {
    notFound();
  }

  const apiProducts = await getProducts();
  const apiProduct = apiProducts.find((p) => p.slug === params.slug);
  if (apiProduct && apiProduct.available === false) {
    return (
      <section className="bg-[#ececec] py-6 md:py-8">
        <Container className="max-w-[1440px]">
          <div className="flex min-h-[calc(100svh-8.5rem)] flex-col items-center justify-center gap-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">{product.shortName}</p>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 md:text-5xl">{product.name}</h1>
            <span className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white">ปิดรับสั่งซื้อ</span>
            <p className="max-w-xs text-sm text-zinc-500">ขณะนี้ยังไม่เปิดรับคำสั่งซื้อสินค้านี้ กรุณากลับมาใหม่ในภายหลัง</p>
            <Link href="/products" className="mt-2 text-sm font-semibold text-apple-blue hover:underline">ดูสินค้าอื่น</Link>
          </div>
        </Container>
      </section>
    );
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <ProductConfigurator
          product={product}
        intent={normalizeConfigureIntent(searchParams?.intent)}
        editingItemId={searchParams?.itemId}
        defaultSize={searchParams?.size}
        defaultQuantity={searchParams?.quantity}
        defaultSchool={searchParams?.school}
      />
      </Container>
    </section>
  );
}
