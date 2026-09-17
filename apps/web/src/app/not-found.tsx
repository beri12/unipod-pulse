import { Button } from '@unipods/ui';
import Link from 'next/link';

/**
 * The App Router's own 404.
 *
 * Without this file Next falls back to a built-in not-found page that lives in
 * the Pages Router, which an App-Router-only app has no other reason to load.
 * Owning the page keeps every request inside one router, and means a reader who
 * mistypes a URL gets somewhere useful rather than a bare error.
 */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page does not exist</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        The link may be out of date, or the page may have been removed. Everything the community
        knows is still searchable from the assistant.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/chat">Ask a question</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
