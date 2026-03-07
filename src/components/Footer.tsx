import { Container } from "@/components/ui/Container";

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white py-10">
      <Container className="flex flex-col items-start justify-between gap-3 text-sm text-zinc-500 md:flex-row md:items-center">
        <p>© {new Date().getFullYear()} SU STORE</p>
        <p>Minimal premium shirt collection.</p>
      </Container>
    </footer>
  );
}
