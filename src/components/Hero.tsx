"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white to-mist py-20 md:py-24">
      <Container className="flex min-h-[78vh] flex-col items-center justify-center text-center">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-sm font-medium tracking-[0.16em] text-zinc-500"
        >
          PREMIUM COTTON COLLECTION
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08 }}
          className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-ink md:text-7xl"
        >
          FRESHER
          <br />
          POLO SHIRT
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16 }}
          className="mt-6 max-w-2xl text-lg text-zinc-600 md:text-2xl"
        >
          Minimal design. Premium comfort. Built for your everyday fit.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.24 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <BuyButton href="/checkout">Shop Now</BuyButton>
          <BuyButton href="/products" variant="secondary">
            View Products
          </BuyButton>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-14 w-full max-w-5xl rounded-3xl border border-zinc-200/70 bg-white p-4 shadow-card"
        >
          <Image
            src="/images/video.png"
            alt="Hero shirt"
            width={1600}
            height={1000}
            className="h-auto w-full rounded-2xl"
            priority
          />
        </motion.div>
      </Container>
    </section>
  );
}
