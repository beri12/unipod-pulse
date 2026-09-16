'use client';

import type { CatchUpItem, CatchUpResponse, Importance } from '@unipods/types';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Skeleton, cn } from '@unipods/ui';
import { CalendarClock, Inbox } from 'lucide-react';
import * as React from 'react';
import { SourceCard } from '@/components/source-card';
import { catchUpApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/format';

type Range = 'today' | 'yesterday' | 'week';

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
};

const IMPORTANCE_STYLES: Record<Importance, { dot: string; label: string }> = {
  high: { dot: 'bg-destructive', label: 'Important' },
  medium: { dot: 'bg-warning', label: 'Worth knowing' },
  low: { dot: 'bg-success', label: 'Background' },
};

function rangeParams(range: Range): { date?: string; from?: string; to?: string } {
  const now = new Date();
  if (range === 'today') return { date: toIsoDate(now) };
  if (range === 'yesterday') {
    return { date: toIsoDate(new Date(now.getTime() - 86_400_000)) };
  }
  const from = new Date(now.getTime() - 6 * 86_400_000);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: now.toISOString() };
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function CatchUpPage() {
  const [range, setRange] = React.useState<Range>('today');

  const query = useQuery<CatchUpResponse>({
    queryKey: ['catch-up', range],
    queryFn: () => catchUpApi.get(rangeParams(range)),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarClock className="size-6 text-primary" aria-hidden />
          What did I miss?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Announcements, meetings, documents and discussions from your community, each linked to
          where it came from.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Time range">
        {(Object.keys(RANGE_LABELS) as Range[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={range === value ? 'default' : 'outline'}
            aria-pressed={range === value}
            onClick={() => setRange(value)}
          >
            {RANGE_LABELS[value]}
          </Button>
        ))}
      </div>

      <div className="mt-6">
        {query.isLoading ? (
          <LoadingSkeleton />
        ) : query.isError ? (
          <EmptyState
            title="Could not load your catch-up"
            description={describeError(query.error)}
            action={
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          />
        ) : query.data && !query.data.empty ? (
          <>
            <p className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">
              {query.data.summary}
            </p>
            <ol className="mt-5 space-y-4">
              {query.data.items.map((item) => (
                <li key={item.id}>
                  <CatchUpRow item={item} />
                </li>
              ))}
            </ol>
            <p className="mt-6 text-xs text-muted-foreground">
              Covering {formatDate(query.data.from)} to {formatDate(query.data.to)} · summarised by{' '}
              {query.data.generatedBy.provider}
            </p>
          </>
        ) : (
          <EmptyState
            icon={<Inbox className="size-8" />}
            title="Nothing new in this period"
            description="When announcements, meetings or documents land in this window, they will be summarised here."
          />
        )}
      </div>
    </div>
  );
}

function CatchUpRow({ item }: { item: CatchUpItem }) {
  const style = IMPORTANCE_STYLES[item.importance];
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('size-2 rounded-full', style.dot)} aria-hidden />
        <Badge variant="outline">{style.label}</Badge>
        <Badge variant="outline" className="capitalize">
          {item.type}
        </Badge>
      </div>
      <h2 className="mt-2 text-sm font-semibold">{item.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
      <div className="mt-3">
        <SourceCard source={item.source} />
      </div>
    </article>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <span className="sr-only">Loading your catch-up…</span>
      <Skeleton className="h-16 w-full" />
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} className="h-40 w-full" />
      ))}
    </div>
  );
}
