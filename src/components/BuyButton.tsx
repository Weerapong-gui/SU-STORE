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
  const buttonBaseClasses =
    "inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold tracking-[0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";
  const buttonVariantClasses = {
    primary:
      "bg-apple-blue text-white shadow-[0_4px_14px_rgba(0,113,227,0.35)] hover:bg-apple-blue-dark active:scale-[0.98]",
    secondary:
      "bg-apple-blue-soft text-apple-blue hover:bg-[#dcecff] active:scale-[0.98]",
    dark:
      "bg-apple-blue-light text-white shadow-[0_4px_14px_rgba(41,151,255,0.35)] hover:bg-apple-blue active:scale-[0.98]"
  };

  return (
    <Link href={href} className={cn(buttonBaseClasses, buttonVariantClasses[variant], className)}>
      {children}
    </Link>
  );
}
