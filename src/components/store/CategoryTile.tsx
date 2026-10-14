import { cn } from "@/lib/utils";

// Neutral fallback when a category has no cover: its name on a mist tile (no school colours in code).
export function CategoryImage({ src, name, className }: { src: string; name: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" className={cn("object-cover", className)} />;
  }
  return (
    <span className={cn("flex items-center justify-center bg-mist p-1 text-center text-xs font-semibold text-ink-soft", className)}>
      {name}
    </span>
  );
}
