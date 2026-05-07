"use client";

import { useEffect, useRef, useState } from "react";

type BankAccountCopyFieldProps = {
  formattedAccountNumber: string;
  copyValue: string;
};

const COPY_FEEDBACK_DURATION_MS = 2000;

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-none stroke-current stroke-[1.8]">
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function BankAccountCopyField({
  formattedAccountNumber,
  copyValue
}: BankAccountCopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await copyText(copyValue.replace(/\D/g, ""));
      setCopied(true);
    } catch (error) {
      console.error("Failed to copy bank account number", error);
      return;
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setCopied(false);
    }, COPY_FEEDBACK_DURATION_MS);
  }

  return (
    <div className="mt-5 rounded-[1.75rem] bg-[#e7e7e7] p-4 sm:p-5">
      <div className="flex justify-center">
        <div className="inline-flex max-w-full items-center gap-2 sm:gap-3">
          <p className="whitespace-nowrap text-[clamp(1.28rem,4.9vw,3rem)] font-medium leading-none tracking-[0.01em] text-zinc-950 sm:tracking-[0.04em]">
            {formattedAccountNumber}
          </p>

          <div className="relative shrink-0">
            {copied ? (
              <span className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-full bg-zinc-950 px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-white">
                Copied
              </span>
            ) : null}

            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy bank account number"
              className="flex size-10 items-center justify-center rounded-2xl bg-zinc-950 text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-400/40 sm:size-12"
            >
              <CopyIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
