"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white to-mist pt-8 md:pt-12">
      <Container className="flex min-h-[56vh] flex-col items-center justify-start pb-8 text-center md:min-h-[62vh] md:pb-10">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-sm font-medium tracking-[0.16em] text-zinc-500"
        >
          Fresher Package 28th
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
        {/*
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16 }}
          className="mt-6 max-w-2xl text-lg text-zinc-600 md:text-2xl"
        >
          Minimal design. Premium comfort. Built for your everyday fit.
        </motion.p>
          */}
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
      </Container>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.28 }}
        className="w-full pb-10 md:pb-14"
      >
        <div className="relative mx-auto aspect-[16/9] w-full max-w-[1920px] overflow-hidden">
          <Image
            src="/images/pr1.png"
            alt="Fresher polo shirt strip"
            fill
            priority
            sizes="(min-width: 1920px) 1920px, 100vw"
            className="object-cover object-center"
          />
        </div>
      </motion.div>
    </section>
  );
}
