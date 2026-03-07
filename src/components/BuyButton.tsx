import Link from "next/link";
import { cn } from "@/lib/utils";

type BuyButtonProps = {
  href: string;
  children: string;
  variant?: "primary" | "secondary" | "dark";
  className?: string;
};

export function BuyButton({
  href,
  children,
  variant = "primary",
  className
}: BuyButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium transition duration-300";
  const styles = {
    primary: "bg-black text-white hover:scale-[1.02] hover:bg-zinc-900",
    secondary: "bg-zinc-100 text-zinc-900 hover:scale-[1.02] hover:bg-zinc-200",
    dark: "bg-white text-black hover:scale-[1.02] hover:bg-zinc-200"
  };

  return (
    <Link href={href} className={cn(base, styles[variant], className)}>
      {children}
    </Link>
  );
}
