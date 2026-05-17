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
  ...props
}: SkeletonImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && (
        <div
          className={cn(
            "absolute inset-0 animate-pulse bg-zinc-200",
            skeletonClassName
          )}
        />
      )}
      <Image
        {...props}
        className={cn(
          className,
          "transition-opacity duration-500",
          loaded ? "opacity-100" : "opacity-0"
        )}
        onLoad={(e) => {
          setLoaded(true);
          (onLoad as ((e: React.SyntheticEvent<HTMLImageElement>) => void) | undefined)?.(e);
        }}
      />
    </>
  );
}
