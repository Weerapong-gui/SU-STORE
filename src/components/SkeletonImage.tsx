"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

type SkeletonImageProps = React.ComponentProps<typeof Image> & {
  skeletonClassName?: string;
};

export function SkeletonImage({
  className,
  skeletonClassName,
  onLoad,
  placeholder,
  blurDataURL,
  ...props
}: SkeletonImageProps) {
  const hasBlur = placeholder === "blur" && !!blurDataURL;
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!hasBlur && !loaded && (
        <div
          className={cn(
            "absolute inset-0 animate-pulse bg-zinc-200",
            skeletonClassName
          )}
        />
      )}
      <Image
        {...props}
        placeholder={placeholder}
        blurDataURL={blurDataURL}
        className={cn(
          className,
          !hasBlur && "transition-opacity duration-500",
          !hasBlur && (loaded ? "opacity-100" : "opacity-0")
        )}
        onLoad={(e) => {
          setLoaded(true);
          (onLoad as ((e: React.SyntheticEvent<HTMLImageElement>) => void) | undefined)?.(e);
        }}
      />
    </>
  );
}
