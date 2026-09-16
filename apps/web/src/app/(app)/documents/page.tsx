'use client';

import type { DocumentDto, Paginated } from '@unipods/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
import { FileText, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { isInFlight, StatusBadge } from '@/components/status-badge';
import { UploadDialog } from '@/components/upload-dialog';
import { documentsApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatBytes, formatDate } from '@/lib/format';

export default function DocumentsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const query = useQuery<Paginated<DocumentDto>>({
    queryKey: ['documents', debounced],
    queryFn: () => documentsApi.list({ limit: 50, search: debounced || undefined }),
    // Poll while anything is still being processed so status updates on its own.
    refetchInterval: (result) =>
      result.state.data?.items.some((document) => isInFlight(document.status)) ? 2500 : false,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['documents'] });

  const reprocess = useMutation({
    mutationFn: (id: string) => documentsApi.process(id),
    onSuccess: () => {
      toast.success('Re-queued for processing');
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => {
      toast.success('Document deleted');
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            PDFs, Word files, Markdown and plain text that the assistant can cite.
          </p>
        </div>
        {isAdmin ? (
          <UploadDialog
            triggerLabel="Upload document"
            title="Upload a document"
            description="The file is stored, then extracted, chunked and embedded in the background."
            accept=".pdf,.docx,.txt,.md,.markdown"
            fileLabel="File (PDF, DOCX, TXT or Markdown)"
            fields={[
              { name: 'title', label: 'Title', placeholder: 'Defaults to the file name' },
              { name: 'description', label: 'Description', type: 'textarea' },
              {
                name: 'publishedAt',
                label: 'Published on',
                type: 'date',
                hint: 'Used to rank recent information ahead of older information.',
              },
            ]}
            onSubmit={async (form) => {
              // The date input gives YYYY-MM-DD; the API wants ISO 8601.
              const published = form.get('publishedAt');
              if (typeof published === 'string' && published) {
                form.set('publishedAt', new Date(`${published}T00:00:00Z`).toISOString());
              }
              await documentsApi.upload(form);
            }}
            onDone={invalidate}
          />
        ) : null}
      </div>

      <div className="mt-6">
        <label htmlFor="document-search" className="sr-only">
          Filter documents
        </label>
        <Input
          id="document-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by title, description or file name…"
        />
      </div>

      <div className="mt-4">
        {query.isLoading ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-14 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState title="Could not load documents" description={describeError(query.error)} />
        ) : query.data && query.data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Added</TableHead>
                {isAdmin ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    <Link
                      href={`/documents/${document.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {document.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {document.originalFileName} · {formatBytes(document.fileSize)}
                    </span>
                    {document.status === 'FAILED' && document.statusMessage ? (
                      <span className="mt-1 block text-xs text-destructive">
                        {document.statusMessage}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs uppercase text-muted-foreground">
                    {document.type}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={document.status} />
                  </TableCell>
                  <TableCell className="tabular-nums">{document.chunkCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(document.createdAt)}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reprocess ${document.title}`}
                          loading={reprocess.isPending && reprocess.variables === document.id}
                          onClick={() => reprocess.mutate(document.id)}
                        >
                          <RefreshCw aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${document.title}`}
                          onClick={() => {
                            if (window.confirm(`Delete “${document.title}” and its index?`)) {
                              remove.mutate(document.id);
                            }
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={<FileText className="size-8" />}
            title={debounced ? 'No documents match that filter' : 'No documents yet'}
            description={
              debounced
                ? 'Try a different word, or clear the filter.'
                : isAdmin
                  ? 'Upload a PDF, Word file or Markdown document and it becomes answerable within seconds.'
                  : 'An administrator has not added any documents yet.'
            }
          />
        )}
      </div>
    </div>
  );
}
