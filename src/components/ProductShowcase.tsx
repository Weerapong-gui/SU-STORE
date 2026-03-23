"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Product } from "@/types/product";
import { Container } from "@/components/ui/Container";
import { BuyButton } from "@/components/BuyButton";
import { formatPrice } from "@/lib/formatPrice";
import { cn } from "@/lib/utils";

type ProductShowcaseProps = {
  product: Product;
  isReversedLayout?: boolean;
  isDarkTheme?: boolean;
};

export function ProductShowcase({
  product,
  isReversedLayout = false,
  isDarkTheme = false
}: ProductShowcaseProps) {
  const sectionThemeClasses = isDarkTheme
    ? "bg-gradient-to-b from-black to-zinc-900 text-white"
    : "bg-white text-ink";
  const eyebrowTextClasses = isDarkTheme ? "text-zinc-300" : "text-zinc-500";
  const featureTagClasses = isDarkTheme
    ? "border-zinc-700 bg-zinc-800/70 text-zinc-200"
    : "border-zinc-200 bg-zinc-50 text-zinc-700";
  const priceTextClasses = isDarkTheme ? "text-apple-blue-light" : "text-apple-blue";
  const visualCardClasses = isDarkTheme
    ? "border-zinc-700 bg-zinc-900"
    : "border-zinc-200 bg-white";

  return (
    <section className={cn("py-24 md:py-32", sectionThemeClasses)}>
      <Container>
        <div className="grid items-center gap-12 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ duration: 0.6 }}
            className={cn("order-2 space-y-6", isReversedLayout ? "md:order-2" : "md:order-1")}
          >
            <p className={cn("text-sm tracking-[0.14em]", eyebrowTextClasses)}>
              {product.shortName}
            </p>
            <h2 className="text-4xl font-semibold tracking-tight md:text-6xl">
              {product.name}
            </h2>
            {/* 
            <p className={cn("max-w-xl text-lg md:text-2xl", isDarkTheme ? "text-zinc-300" : "text-zinc-600")}>
              {product.tagline}
            </p>
            
            <p className={cn("max-w-xl", isDarkTheme ? "text-zinc-300" : "text-zinc-600")}>
              {product.description}
            </p>
             */}

            <div className="flex flex-wrap gap-3 pt-2">
              {product.features.map((feature) => (
                <span
                  key={feature}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm",
                    featureTagClasses
                  )}
                >
                  {feature}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-4 pt-2">
              <p className={cn("text-2xl font-semibold", priceTextClasses)}>{formatPrice(product.price)}</p>
              <BuyButton
                href={`/checkout?product=${product.slug}`}
                variant={isDarkTheme ? "dark" : "primary"}
              >
                Buy Now
              </BuyButton>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.65 }}
            className={cn(
              "order-1 rounded-3xl border p-4 shadow-soft",
              isReversedLayout ? "md:order-1" : "md:order-2",
              visualCardClasses
            )}
          >
            <Image
              src={product.images[0]}
              alt={product.name}
              width={1200}
              height={900}
              className="h-auto w-full rounded-2xl"
            />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
