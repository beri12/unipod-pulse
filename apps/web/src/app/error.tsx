'use client';

import { Button } from '@unipods/ui';
import * as React from 'react';

/**
 * The App Router's own error boundary.
 *
 * Without it Next falls back to a built-in error page from the Pages Router.
 * The `digest` is the only thing shown about the failure: the message itself
 * can carry stack frames and internal paths, and belongs in the server log,
 * where the same digest identifies it.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Unhandled error', error);
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-24 text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        This page could not be loaded. Trying again often works; if it does not, an administrator
        can find this in the logs.
      </p>
      {error.digest ? (
        <p className="mt-4 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <a href="/chat">Back to the assistant</a>
        </Button>
      </div>
    </main>
  );
}
