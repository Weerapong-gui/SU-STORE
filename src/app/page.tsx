import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { FeatureSection } from "@/components/FeatureSection";
import { CompareSection } from "@/components/CompareSection";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { products } from "@/data/products";

export default function HomePage() {
  const single = products.find((item) => item.category === "single") ?? products[0];
  const set = products.find((item) => item.category === "set") ?? products[1];

  return (
    <>
      <Hero />
      <ProductShowcase product={single} />
      <ProductShowcase product={set} reversed dark />
      <FeatureSection />
      <CompareSection />

      <section className="bg-gradient-to-b from-white to-mist py-24 md:py-32">
        <Container className="text-center">
          <SectionTitle
            align="center"
            title="เลือกสไตล์ที่ใช่สำหรับคุณ"
            subtitle="เริ่มจากเสื้อเดี่ยว หรือไปสุดด้วยชุดเซต"
          />
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <BuyButton href={`/checkout?product=${single.slug}`}>Buy Single Shirt</BuyButton>
            <BuyButton href={`/checkout?product=${set.slug}`} variant="secondary">
              Buy Set
            </BuyButton>
          </div>
        </Container>
      </section>
    </>
  );
}
