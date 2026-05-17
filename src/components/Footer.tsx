"use client";

import { Container } from "@/components/ui/Container";
import { Instagram, Facebook } from "lucide-react";
import { useLang } from "@/lib/i18n";

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { lang } = useLang();

  const contactNote = lang === "th"
    ? "หากพบปัญหาขัดข้องเกี่ยวกับระบบให้ติดต่อผู้ดูแลระบบ โทร : 0838627000 ปาร์ค"
    : "For system issues, please contact admin. Tel : 0838627000 Park";

  return (
    <footer className="bg-surface-dark py-12 md:py-16">
      <Container>
        <div className="border-b border-white/10 pb-8">
          <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">SU STORE</p>
          <p className="mt-2 text-sm text-zinc-400">
            Fresher Package 28th — Contemporary Lanna Collection.
          </p>
          <div className="mt-4">
            <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CONTACT US</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href="https://www.instagram.com/su.mfu/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white"
              >
                <Instagram className="h-4 w-4" />
                @su.mfu
              </a>
              <a
                href="https://www.facebook.com/mfu.su"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white"
              >
                <Facebook className="h-4 w-4" />
                mfu.su
              </a>
              <a
                href="https://www.tiktok.com/@su.mfu"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
                </svg>
                @su.mfu
              </a>
            </div>
            <p className="mt-3 text-xs text-zinc-500">{contactNote}</p>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-2 text-xs text-zinc-500 md:flex-row md:items-center md:justify-between">
          <p>
            © {currentYear} SU STORE. All rights reserved.
          </p>
          <p className="text-zinc-600">
            Shirt design by Mr. Suradit Hortham — Winner of the Fresher 28 Shirt Design Contest.
          </p>
        </div>
      </Container>
    </footer>
  );
}
