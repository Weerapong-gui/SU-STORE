"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type MobileProductSliderProps = {
  images: string[];
  productName: string;
  className?: string;
  slideClassName?: string;
};

const NAVIGATION_BUTTON_CLASSES =
  "inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30";
const DOT_BUTTON_CLASSES =
  "h-2.5 rounded-full bg-white/55 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30";
const SWIPE_THRESHOLD = 40;

export function MobileProductSlider({
  images,
  productName,
  className,
  slideClassName
}: MobileProductSliderProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    setActiveIndex(0);
  }, [images]);

  function goToSlide(nextIndex: number) {
    const totalSlides = images.length;
    if (totalSlides === 0) {
      return;
    }

    if (nextIndex < 0) {
      setActiveIndex(totalSlides - 1);
      return;
    }

    if (nextIndex >= totalSlides) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex(nextIndex);
  }

  function handleTouchStart(clientX: number) {
    setTouchStartX(clientX);
  }

  function handleTouchEnd(clientX: number) {
    if (touchStartX === null) {
      return;
    }

    const swipeDistance = clientX - touchStartX;
    setTouchStartX(null);

    if (Math.abs(swipeDistance) < SWIPE_THRESHOLD) {
      return;
    }

    if (swipeDistance < 0) {
      goToSlide(activeIndex + 1);
      return;
    }

    goToSlide(activeIndex - 1);
  }

  if (images.length === 0) {
    return null;
  }

  return (
    <div className={cn("lg:hidden", className)}>
      <div
        className="relative overflow-hidden rounded-[2rem]"
        onTouchStart={(event) => {
          const firstTouch = event.touches[0];
          if (!firstTouch) {
            return;
          }

          handleTouchStart(firstTouch.clientX);
        }}
        onTouchEnd={(event) => {
          const firstTouch = event.changedTouches[0];
          if (!firstTouch) {
            return;
          }

          handleTouchEnd(firstTouch.clientX);
        }}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className={cn("relative w-full shrink-0 overflow-hidden", slideClassName)}
            >
              <Image
                src={image}
                alt={`${productName} image ${index + 1}`}
                fill
                priority={index === 0}
                sizes="100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>

        {images.length > 1 ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between px-3">
              <button
                type="button"
                onClick={() => goToSlide(activeIndex - 1)}
                className={cn("pointer-events-auto", NAVIGATION_BUTTON_CLASSES)}
                aria-label="Previous image"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => goToSlide(activeIndex + 1)}
                className={cn("pointer-events-auto", NAVIGATION_BUTTON_CLASSES)}
                aria-label="Next image"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-2 px-4">
              {images.map((_, index) => (
                <button
                  key={`dot-${index}`}
                  type="button"
                  onClick={() => goToSlide(index)}
                  aria-label={`Go to image ${index + 1}`}
                  aria-pressed={activeIndex === index}
                  className={cn(
                    DOT_BUTTON_CLASSES,
                    activeIndex === index ? "w-6 bg-white" : "w-2.5"
                  )}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
