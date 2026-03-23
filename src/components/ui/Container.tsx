import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ContainerProps = {
  children: ReactNode;
  className?: string;
};

export function Container({ children, className }: ContainerProps) {
  const containerClasses = "mx-auto w-full max-w-6xl px-6 md:px-8";

  return (
    <div className={cn(containerClasses, className)}>{children}</div>
  );
}
