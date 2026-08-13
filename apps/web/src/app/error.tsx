'use client';

import { useEffect } from 'react';

/**
 * Route error boundary. Shows a calm, generic recovery UI — NEVER a stack trace or
 * internal error detail. The digest is a server-side correlation id an operator can
 * look up in logs; it is safe to show to the user.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The framework already logs this server-side with a digest; nothing sensitive here.
  }, [error]);

  return (
    <main style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '0.5rem' }}>Something went wrong</h1>
        <p style={{ opacity: 0.75, marginBottom: '1.25rem' }}>An unexpected error occurred. You can try again, or return home.</p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button onClick={reset} className="btn-primary">Try again</button>
          <a href="/" className="btn-ghost">Go home</a>
        </div>
        {error.digest ? <p style={{ marginTop: '1.25rem', fontSize: '0.8rem', opacity: 0.5 }}>Reference: {error.digest}</p> : null}
      </div>
    </main>
  );
}
