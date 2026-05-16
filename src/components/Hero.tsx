"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { BuyButton } from "@/components/BuyButton";

const buttonMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay: 0.2 },
};

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden">
      {/* Portrait / mobile — Artboard 2 (1080×1920) */}
      <div className="relative block md:hidden">
        <Image
          src="/images/Artboard 2.png"
          alt="Fresher Package"
          width={1080}
          height={1920}
          priority
          sizes="100vw"
          className="h-auto w-full"
        />
        <div className="absolute inset-0 flex justify-center pt-[6%]">
          <motion.div {...buttonMotion}>
            <BuyButton href="/products">Shop Now</BuyButton>
          </motion.div>
        </div>
      </div>

      {/* Landscape / desktop — Artboard 1 (1920×1080) */}
      <div className="relative hidden md:block">
        <Image
          src="/images/Artboard 1.png"
          alt="Fresher Package"
          width={1920}
          height={1080}
          priority
          sizes="100vw"
          className="h-auto w-full"
        />
        <div className="absolute inset-0 flex items-end justify-center pb-14">
          <motion.div {...buttonMotion}>
            <BuyButton href="/products">Shop Now</BuyButton>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
