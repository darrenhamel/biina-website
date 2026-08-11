'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side surface only; server logs hold the detail.
    console.error('app error boundary', error.digest);
  }, [error]);

  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-bold text-ink">Something went wrong.</h1>
        <p className="mt-2 text-sm text-ink-soft">
          An unexpected error occurred. You can try again.
        </p>
        <button onClick={reset} className="btn-primary mt-4">
          Try again
        </button>
      </div>
    </div>
  );
}
