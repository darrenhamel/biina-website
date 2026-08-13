'use client';

/**
 * Global (root layout) error boundary — the last resort when even the layout fails.
 * Renders its own <html>/<body>. No stack traces or internal detail are ever shown.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div style={{ maxWidth: 460, textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '0.5rem' }}>Service temporarily unavailable</h1>
            <p style={{ opacity: 0.75, marginBottom: '1.25rem' }}>We hit an unexpected problem. Please try again in a moment.</p>
            <button onClick={reset} style={{ padding: '0.6rem 1.1rem', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}>Try again</button>
            {error.digest ? <p style={{ marginTop: '1.25rem', fontSize: '0.8rem', opacity: 0.5 }}>Reference: {error.digest}</p> : null}
          </div>
        </main>
      </body>
    </html>
  );
}
