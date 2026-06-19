"use client";

import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      message: "Unhandled client error",
      context: {
        name: error.name,
        message: error.message,
        digest: error.digest,
        stack: error.stack?.slice(0, 500),
        url: typeof window !== "undefined" ? window.location.href : "",
      },
    }));
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-mist p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-tertiary">Error</p>
      <h1 className="text-2xl font-bold text-ink">Something went wrong</h1>
      <p className="max-w-sm text-sm text-ink-secondary">{error.message || "An unexpected error occurred."}</p>
      <button
        onClick={reset}
        className="mt-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white hover:opacity-80"
      >
        Try again
      </button>
    </div>
  );
}
