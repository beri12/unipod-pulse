'use client';

import type { Paginated, SourceKind, SourceRef } from '@unipods/types';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@unipods/ui';
import { Layers } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { sourceHref } from '@/components/source-card';
import { adminApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate, SOURCE_LABELS } from '@/lib/format';

const TYPES: Array<{ value: SourceKind | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Everything' },
  { value: 'DOCUMENT', label: 'Documents' },
  { value: 'MEETING', label: 'Meetings' },
  { value: 'ANNOUNCEMENT', label: 'Announcements' },
  { value: 'MESSAGE', label: 'Messages' },
];

export default function AdminKnowledgePage() {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [type, setType] = React.useState<SourceKind | 'ALL'>('ALL');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const query = useQuery<Paginated<SourceRef & { chunkCount: number }>>({
    queryKey: ['admin', 'knowledge', debounced, type, page],
    queryFn: () =>
      adminApi.knowledge({
        page,
        limit: 25,
        search: debounced || undefined,
        type: type === 'ALL' ? undefined : type,
      }),
  });

  return (
    <div>
      <h2 className="text-lg font-semibold">Knowledge base</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything the assistant is able to cite. If something is missing here, it cannot appear in
        an answer.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="knowledge-search" className="sr-only">
            Filter by title
          </label>
          <Input
            id="knowledge-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by title…"
          />
        </div>
        {TYPES.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={type === option.value ? 'default' : 'outline'}
            aria-pressed={type === option.value}
            onClick={() => {
              setType(option.value);
              setPage(1);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="mt-4">
        {query.isLoading ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState title="Could not load the knowledge base" description={describeError(query.error)} />
        ) : query.data && query.data.items.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dated</TableHead>
                  <TableHead>Passages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((source) => {
                  const href = sourceHref(source, source.metadata);
                  return (
                    <TableRow key={source.id}>
                      <TableCell>
                        {href ? (
                          <Link href={href} className="font-medium underline-offset-4 hover:underline">
                            {source.title}
                          </Link>
                        ) : (
                          <span className="font-medium">{source.title}</span>
                        )}
                        {source.authorName ? (
                          <span className="block text-xs text-muted-foreground">
                            {source.authorName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{SOURCE_LABELS[source.type]}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(source.occurredAt) || '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">{source.chunkCount}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="mt-4 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {query.data.page} of {query.data.totalPages} · {query.data.total} sources
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= query.data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Layers className="size-8" />}
            title="The knowledge base is empty"
            description="Upload a document, add a meeting or import messages to give the assistant something to cite."
          />
        )}
      </div>
    </div>
  );
}
