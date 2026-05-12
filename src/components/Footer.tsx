import { Container } from "@/components/ui/Container";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-surface-dark py-12 md:py-16">
      <Container>
        <div className="border-b border-white/10 pb-8">
          <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">SU STORE</p>
          <p className="mt-2 text-sm text-zinc-400">
            Fresher Package 28th — Contemporary Lanna Collection.
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-2 text-xs text-zinc-500 md:flex-row md:items-center md:justify-between">
          <p>
            © {currentYear} SU STORE. All rights reserved.
          </p>
          <p className="text-zinc-600">
            Designed by Mr. Suradit Hortham — Winner of the Fresher 28 Shirt Design Contest.
          </p>
        </div>
      </Container>
    </footer>
  );
}
