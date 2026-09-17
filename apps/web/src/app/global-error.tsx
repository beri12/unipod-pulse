'use client';

import * as React from 'react';

/**
 * Last-resort boundary, for an error thrown by the root layout itself.
 *
 * It replaces the whole document, so it must render its own `<html>` and
 * `<body>` and cannot rely on the app's providers, fonts or stylesheet — the
 * styles here are inline for that reason. Without this file Next falls back to
 * a built-in page from the Pages Router.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Root layout error', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#ffffff',
          color: '#12151c',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
            UniPods Pulse could not start
          </h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, opacity: 0.75 }}>
            Something failed before the application could load. Reloading often works.
          </p>
          {error.digest ? (
            <p style={{ marginTop: '1rem', fontFamily: 'monospace', fontSize: '0.75rem', opacity: 0.6 }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              borderRadius: '0.375rem',
              border: '1px solid currentColor',
              background: 'transparent',
              cursor: 'pointer',
              color: 'inherit',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
