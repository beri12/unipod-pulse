'use client';

import { Skeleton } from '@unipods/ui';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/providers';

/** Every page in this group requires a signed-in user. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth fallback={<AppLoading />}>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}

function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10" aria-busy>
      <span className="sr-only">Loading your session…</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-4 h-64 w-full" />
    </div>
  );
}
