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
    "inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium transition duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";
  const styles = {
    primary:
      "bg-apple-blue text-white shadow-[0_10px_24px_rgba(0,113,227,0.28)] hover:scale-[1.02] hover:bg-apple-blue-dark",
    secondary:
      "border border-apple-blue/15 bg-apple-blue-soft text-apple-blue hover:scale-[1.02] hover:border-apple-blue/30 hover:bg-[#dcecff]",
    dark:
      "bg-apple-blue-light text-white shadow-[0_10px_24px_rgba(41,151,255,0.28)] hover:scale-[1.02] hover:bg-apple-blue"
  };

  return (
    <Link href={href} className={cn(base, styles[variant], className)}>
      {children}
    </Link>
  );
}
