"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white to-mist pt-8 md:pt-12">
      <Container className="flex min-h-0 flex-col items-center justify-start pb-6 text-center md:min-h-[48vh] md:pb-8 lg:min-h-[56vh] lg:pb-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08 }}
          className="mt-2"
        >
          <Image
            src="/images/FresherPackageLOGO.png"
            alt="Fresher Package logo"
            width={1235}
            height={1009}
            priority
            className="h-auto w-[min(56vw,10.5rem)] md:w-[min(34vw,14rem)] lg:w-[min(24vw,16rem)]"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.24 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <BuyButton href="/products">Shop Now</BuyButton>
        </motion.div>
      </Container>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.28 }}
        className="-mt-4 w-full pb-10 md:-mt-6 md:pb-14"
      >
        <div className="relative mx-auto aspect-[16/9] w-full max-w-[1920px] overflow-hidden">
          <Image
            src="/images/Pr1.png"
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
