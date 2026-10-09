"use client";

import { motion } from "framer-motion";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";
import { useStoreText } from "@/lib/storeI18n";

export function Hero() {
  const t = useStoreText();
  return (
    <section className="bg-mist">
      <Container className="py-20 text-center md:py-28">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <p className="text-sm font-semibold tracking-[0.12em] text-apple-blue">{t.brandTagline}</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight text-ink md:text-7xl">{t.heroTitle}</h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-soft md:text-lg">{t.heroSubtitle}</p>
          <div className="mt-8">
            <BuyButton href="/products">{t.shopNow}</BuyButton>
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
