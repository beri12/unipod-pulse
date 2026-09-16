'use client';

import type { SearchResponse, SourceKind } from '@unipods/types';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Input, Skeleton } from '@unipods/ui';
import { Search as SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Suspense } from 'react';
import { sourceHref } from '@/components/source-card';
import { searchApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate, SOURCE_LABELS } from '@/lib/format';

const FILTERS: Array<{ value: SourceKind | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Everything' },
  { value: 'MESSAGE', label: 'Messages' },
  { value: 'ANNOUNCEMENT', label: 'Announcements' },
  { value: 'MEETING', label: 'Meetings' },
  { value: 'DOCUMENT', label: 'Documents' },
];

function SearchPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const initialType = (params.get('types') as SourceKind | null) ?? 'ALL';

  const [draft, setDraft] = React.useState(initialQuery);
  const [submitted, setSubmitted] = React.useState(initialQuery);
  const [filter, setFilter] = React.useState<SourceKind | 'ALL'>(initialType);

  React.useEffect(() => {
    setDraft(initialQuery);
    setSubmitted(initialQuery);
  }, [initialQuery]);

  const query = useQuery<SearchResponse>({
    queryKey: ['search', submitted, filter],
    queryFn: () =>
      searchApi.search(submitted, filter === 'ALL' ? {} : { types: [filter] }),
    enabled: submitted.trim().length > 0,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    setSubmitted(value);
    // Keeps the search shareable and survivable across a reload.
    const next = new URLSearchParams();
    if (value) next.set('q', value);
    if (filter !== 'ALL') next.set('types', filter);
    router.replace(`/search${next.size > 0 ? `?${next.toString()}` : ''}`);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The same retrieval the assistant uses, without the answering step.
      </p>

      <form onSubmit={submit} className="mt-6 flex gap-2" role="search">
        <label htmlFor="search-input" className="sr-only">
          Search the knowledge base
        </label>
        <Input
          id="search-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search messages, meetings and documents…"
          autoComplete="off"
        />
        <Button type="submit" disabled={draft.trim().length === 0}>
          <SearchIcon aria-hidden />
          <span className="sr-only sm:not-sr-only">Search</span>
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by source type">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filter === option.value ? 'default' : 'outline'}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="mt-6">
        {submitted.trim().length === 0 ? (
          <EmptyState
            icon={<SearchIcon className="size-8" />}
            title="Search your community"
            description="Try a name, a date, a decision or a phrase you half-remember."
          />
        ) : query.isLoading ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-24 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState title="Search failed" description={describeError(query.error)} />
        ) : query.data && query.data.results.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">
              {query.data.results.length} result{query.data.results.length === 1 ? '' : 's'} in{' '}
              {query.data.took} ms
            </p>
            <ol className="mt-3 space-y-3">
              {query.data.results.map((result) => {
                const href = sourceHref(result.source, result.source.metadata);
                return (
                  <li key={result.id}>
                    <Link
                      href={href ?? '#'}
                      className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{SOURCE_LABELS[result.type]}</Badge>
                        {result.occurredAt ? (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(result.occurredAt)}
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {result.score.toFixed(2)}
                        </span>
                      </div>
                      <h2 className="mt-1.5 text-sm font-medium">{result.title}</h2>
                      {/* The API escapes the snippet and adds only <mark>. */}
                      <p
                        className="mt-1 text-sm leading-relaxed text-muted-foreground"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                      />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <EmptyState
            title={`No matches for “${submitted}”`}
            description="Try fewer words, or a different filter. Nothing is hidden — if it is not here, it has not been added to the knowledge base yet."
          />
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}
