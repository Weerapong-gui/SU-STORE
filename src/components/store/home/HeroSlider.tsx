"use client";

import { useEffect, useRef, useState } from "react";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";
import { useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import type { HeroSlide } from "@/types/store";

const INTERVAL_MS = 5000;

// A slide left completely blank shows the built-in bilingual store intro.
function isBlank(s: HeroSlide) {
  return !s.image && !s.eyebrow && !s.title && !s.subtitle && !s.buttonText;
}

function SlideContent({ slide, onImage }: { slide: HeroSlide; onImage: boolean }) {
  const t = useStoreText();
  const intro = isBlank(slide);
  const eyebrow = intro ? t.brandTagline : slide.eyebrow;
  const title = intro ? t.heroTitle : slide.title;
  const subtitle = intro ? t.heroSubtitle : slide.subtitle;
  const button = intro ? { text: t.shopNow, href: "/products" } : { text: slide.buttonText, href: slide.buttonHref };

  return (
    <div className={cn("mx-auto max-w-2xl", onImage && "[text-shadow:0_1px_12px_rgb(0_0_0/0.45)]")}>
      {eyebrow && (
        <p className={cn("text-sm font-semibold tracking-[0.12em]", onImage ? "text-white/85" : "text-apple-blue")}>{eyebrow}</p>
      )}
      {title && (
        <h1 className={cn("mt-3 text-4xl font-semibold tracking-tight md:text-6xl", onImage ? "text-white" : "text-ink")}>{title}</h1>
      )}
      {subtitle && (
        <p className={cn("mx-auto mt-5 max-w-xl whitespace-pre-line text-base leading-relaxed md:text-lg", onImage ? "text-white/90" : "text-ink-soft")}>
          {subtitle}
        </p>
      )}
      {button.text && button.href && (
        <div className="mt-8">
          <BuyButton href={button.href}>{button.text}</BuyButton>
        </div>
      )}
    </div>
  );
}

export function HeroSlider({ slides, autoplay }: { slides: HeroSlide[]; autoplay: boolean }) {
  const t = useStoreText();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = slides.length;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (count < 2 || !autoplay || paused || reducedMotion) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % count), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [count, autoplay, paused, reducedMotion]);

  const go = (i: number) => setActive(((i % count) + count) % count);
  const hasImages = slides.some((s) => s.image);

  return (
    <section
      className={cn("relative overflow-hidden", hasImages ? "bg-ink" : "bg-mist")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) go(active + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
      aria-roledescription={count > 1 ? "carousel" : undefined}
    >
      <div className="grid">
        {slides.map((slide, i) => (
          <div
            key={i}
            className={cn(
              "relative col-start-1 row-start-1 transition-opacity duration-700",
              i === active ? "opacity-100" : "pointer-events-none opacity-0",
              slide.image ? "" : "bg-mist"
            )}
            aria-hidden={i !== active}
          >
            {slide.image && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.image} alt="" className="absolute inset-0 h-full w-full object-cover" loading={i === 0 ? "eager" : "lazy"} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/50 to-black/35" />
              </>
            )}
            <Container
              className={cn(
                "relative flex flex-col items-center justify-center text-center",
                slide.image ? "min-h-[440px] py-20 md:min-h-[560px]" : "py-20 md:py-28"
              )}
            >
              <div className={i === 0 ? "hero-in" : undefined}>
                <SlideContent slide={slide} onImage={!!slide.image} />
              </div>
            </Container>
          </div>
        ))}
      </div>

      {count > 1 && (
        <div className="absolute inset-x-0 bottom-5 flex justify-center gap-2">
          {slides.map((slide, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={t.slideLabel(i + 1)}
              aria-current={i === active}
              className={cn(
                "h-2 rounded-full transition-all",
                i === active ? "w-6" : "w-2",
                slide.image || slides[active].image
                  ? i === active ? "bg-white" : "bg-white/50 hover:bg-white/80"
                  : i === active ? "bg-ink" : "bg-ink/25 hover:bg-ink/50"
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
