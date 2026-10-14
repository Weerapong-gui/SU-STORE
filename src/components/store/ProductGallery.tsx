"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// `fallback` (a design code) fills the frame when there is no image; callers re-key it when the images change.
export function ProductGallery({ images, alt, fallback }: { images: string[]; alt: string; fallback?: string }) {
  const [index, setIndex] = useState(0);
  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-3xl bg-mist">
        {images[index] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[index]} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-6xl font-bold text-zinc-300">{fallback || "SU"}</div>
        )}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              aria-label={`${alt} ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2", i === index ? "border-apple-blue" : "border-transparent")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
