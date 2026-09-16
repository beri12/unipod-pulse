'use client';

import type { DocumentDetail } from '@unipods/types';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, EmptyState, Skeleton } from '@unipods/ui';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { isInFlight, StatusBadge } from '@/components/status-badge';
import { documentsApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { describeLocation, formatBytes, formatDate } from '@/lib/format';

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = useQuery<DocumentDetail>({
    queryKey: ['document', id],
    queryFn: () => documentsApi.byId(id),
    refetchInterval: (result) => (result.state.data && isInFlight(result.state.data.status) ? 2500 : false),
  });

  // A citation links to #chunk-N; bring that passage into view and mark it.
  const [highlighted, setHighlighted] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!query.data) return;
    const hash = window.location.hash.match(/^#chunk-(\d+)$/);
    if (!hash) return;
    const index = Number.parseInt(hash[1] as string, 10);
    setHighlighted(index);
    // Wait for the chunk list to render before scrolling to it.
    const handle = window.setTimeout(() => {
      // Qualified because `document` is shadowed by this page's data below.
      window.document.getElementById(`chunk-${index}`)?.scrollIntoView({ block: 'center' });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [query.data]);

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8" aria-busy>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-4 h-24 w-full" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <EmptyState
          title="Could not load this document"
          description={query.error ? describeError(query.error) : undefined}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/documents">Back to documents</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const document = query.data;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/documents">
          <ArrowLeft aria-hidden />
          Documents
        </Link>
      </Button>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={document.status} />
          <Badge variant="outline">{document.type}</Badge>
          {document.isDemo ? <Badge variant="warning">Demo content</Badge> : null}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{document.title}</h1>
        {document.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{document.description}</p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {document.originalFileName} · {formatBytes(document.fileSize)}
          {document.pageCount ? ` · ${document.pageCount} pages` : ''} · added{' '}
          {formatDate(document.createdAt)}
          {document.createdBy ? ` by ${document.createdBy.name}` : ''}
        </p>
      </header>

      {document.status === 'FAILED' && document.statusMessage ? (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {document.statusMessage}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {document.downloadUrl ? (
          <Button asChild variant="outline" size="sm">
            <a href={document.downloadUrl} target="_blank" rel="noreferrer">
              <Download aria-hidden />
              Download original
            </a>
          </Button>
        ) : null}
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-medium">
          Indexed passages
          <span className="ml-2 font-normal text-muted-foreground">
            {document.embeddedChunkCount} of {document.chunkCount} embedded
          </span>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          These are the exact passages the assistant can retrieve and quote from this document.
        </p>

        {document.chunks.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<FileText className="size-8" />}
            title={
              isInFlight(document.status)
                ? 'Still processing'
                : 'This document has no indexed passages'
            }
            description={
              isInFlight(document.status)
                ? 'Extraction, chunking and embedding are running. This page updates itself.'
                : 'Reprocess the document from the documents list to try again.'
            }
          />
        ) : (
          <ol className="mt-4 space-y-3">
            {document.chunks.map((chunk) => (
              <li key={chunk.id} id={`chunk-${chunk.chunkIndex}`}>
                <Card className={highlighted === chunk.chunkIndex ? 'border-ring' : undefined}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">
                        {describeLocation('DOCUMENT', chunk.metadata) || `Part ${chunk.chunkIndex + 1}`}
                      </Badge>
                      <span>{chunk.tokenCount} tokens</span>
                      {chunk.hasEmbedding ? null : <Badge variant="warning">Not embedded</Badge>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                      {chunk.content}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
