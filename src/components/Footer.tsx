import { Container } from "@/components/ui/Container";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-zinc-200 bg-white py-10">
      <Container className="flex flex-col items-start justify-between gap-3 text-sm text-zinc-500 md:flex-row md:items-center">
        <p>
          © {currentYear} SU STORE <br />
          Designed by Mr. Suradit Hortham,
          <br />
          Winner of the Fresher 28 Shirt Design Contest – Contemporary Lanna Theme.
          <br />
        </p>
        <p>
          Fresher Package 28th.
          <br />
          All rights reserved.
        </p>
      </Container>
    </footer>
  );
}
