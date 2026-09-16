'use client';

import { Skeleton, cn } from '@unipods/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RequireAuth } from '@/components/providers';

const TABS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/documents', label: 'Documents' },
  { href: '/admin/meetings', label: 'Meetings' },
  { href: '/admin/messages', label: 'Messages' },
  { href: '/admin/knowledge', label: 'Knowledge' },
  { href: '/admin/questions', label: 'Questions' },
];

/** Admin pages are gated a second time here, not only by the API. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <RequireAuth adminOnly fallback={<Skeleton className="m-8 h-64" />}>
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What the community knows, what it is missing, and how the system is doing.
        </p>

        <nav aria-label="Admin sections" className="mt-6 border-b border-border">
          <ul className="-mb-px flex flex-wrap gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const active = pathname === tab.href;
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-6">{children}</div>
      </div>
    </RequireAuth>
  );
}
