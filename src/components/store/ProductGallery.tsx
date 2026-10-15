"use client";

import { useRef, useState } from "react";
import { useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";

const arrowClass =
  "absolute top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-circle bg-white/90 text-xl leading-none text-ink shadow-md opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 disabled:invisible md:flex";

// `fallback` (a design code) fills the frame when there is no image; callers re-key it when the images change so the index resets.
// Phones swipe the scroll-snap track; desktop gets hover arrows. The index follows scrollLeft so both stay in sync.
export function ProductGallery({ images, alt, fallback }: { images: string[]; alt: string; fallback?: string }) {
  const t = useStoreText();
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = images.length;
  const hasControls = count > 1;

  function scrollToImage(target: number) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: target * track.clientWidth, behavior: "smooth" });
  }

  function onScroll() {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    setIndex(Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth))));
  }

  return (
    <div>
      <div className="group relative aspect-square overflow-hidden rounded-3xl bg-mist">
        {count === 0 ? (
          <div className="flex h-full items-center justify-center text-6xl font-bold text-zinc-300">{fallback || "SU"}</div>
        ) : (
          <div
            ref={trackRef}
            data-gallery-track
            onScroll={hasControls ? onScroll : undefined}
            className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={i === 0 ? alt : `${alt} ${t.imageCount(i + 1, count)}`}
                loading={i === 0 ? undefined : "lazy"}
                className="h-full w-full shrink-0 snap-start object-cover"
              />
            ))}
          </div>
        )}
        {hasControls && (
          <>
            <button
              type="button"
              aria-label={t.previousImage}
              disabled={index === 0}
              onClick={() => scrollToImage(index - 1)}
              className={cn(arrowClass, "left-3")}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t.nextImage}
              disabled={index === count - 1}
              onClick={() => scrollToImage(index + 1)}
              className={cn(arrowClass, "right-3")}
            >
              ›
            </button>
            <span className="absolute bottom-3 right-3 rounded-circle bg-black/55 px-2.5 py-1 text-xs font-medium text-white md:hidden">
              {t.imageCount(index + 1, count)}
            </span>
          </>
        )}
      </div>
      {hasControls && (
        <div className="mt-2 flex justify-center">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              data-gallery-dot
              aria-label={t.imageCount(i + 1, count)}
              aria-current={i === index}
              onClick={() => scrollToImage(i)}
              // The visible dot is 6px; the button pads it into a usable tap target.
              className="flex h-6 items-center justify-center px-1"
            >
              <span className={cn("h-1.5 rounded-circle transition-all", i === index ? "w-4 bg-ink" : "w-1.5 bg-zinc-300")} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
