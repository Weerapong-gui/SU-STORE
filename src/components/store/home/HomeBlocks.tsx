"use client";

import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";
import { ProductGrid } from "@/components/store/ProductGrid";
import { useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import type { HomeBlock, ResolvedHome } from "@/types/store";
import { HeroSlider } from "./HeroSlider";

const headingClass = "mb-8 text-2xl font-semibold tracking-tight text-ink md:text-3xl";

function Block({ block, products }: { block: HomeBlock; products: ResolvedHome["products"] }) {
  const t = useStoreText();
  switch (block.type) {
    case "hero":
      return <HeroSlider slides={block.slides} autoplay={block.autoplay} />;
    case "featured":
      return (
        <Container className="py-14 md:py-20">
          <h2 className={headingClass}>{block.title || t.featured}</h2>
          <ProductGrid products={block.products ?? []} />
        </Container>
      );
    case "allProducts":
      return (
        <Container className="py-14 md:py-20">
          <h2 className={headingClass}>{block.title || t.allProducts}</h2>
          <ProductGrid products={products} />
        </Container>
      );
    case "text":
      return (
        <Container className={cn("py-12 md:py-16", block.align === "center" && "text-center")}>
          <div className={cn("max-w-3xl", block.align === "center" && "mx-auto")}>
            {block.title && <h2 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">{block.title}</h2>}
            {block.body && <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-soft md:text-lg">{block.body}</p>}
          </div>
        </Container>
      );
    case "imageText":
      return (
        <Container className="py-12 md:py-16">
          <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
            {block.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={block.image}
                alt=""
                loading="lazy"
                className={cn("aspect-[4/3] w-full rounded-3xl bg-mist object-cover", block.imageSide === "right" && "md:order-2")}
              />
            )}
            <div className={cn(!block.image && "md:col-span-2")}>
              {block.title && <h2 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">{block.title}</h2>}
              {block.body && <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-soft md:text-lg">{block.body}</p>}
              {block.buttonText && block.buttonHref && (
                <div className="mt-6">
                  <BuyButton href={block.buttonHref}>{block.buttonText}</BuyButton>
                </div>
              )}
            </div>
          </div>
        </Container>
      );
  }
}

export function HomeBlocks({ home }: { home: ResolvedHome }) {
  return (
    <>
      {home.blocks.map((block) => (
        <Block key={block.id} block={block} products={home.products} />
      ))}
    </>
  );
}
