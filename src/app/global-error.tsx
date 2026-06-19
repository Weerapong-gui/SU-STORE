"use client";

import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function RootError({ error, reset }: Props) {
  useEffect(() => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      message: "Root layout error",
      context: {
        name: error.name,
        message: error.message,
        digest: error.digest,
        stack: error.stack?.slice(0, 500),
      },
    }));
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center font-sans">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Error</p>
        <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
        <p className="max-w-sm text-sm text-gray-500">{error.message || "An unexpected error occurred."}</p>
        <button
          onClick={reset}
          className="mt-2 rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
