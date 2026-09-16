'use client';

import type { MeetingDto, Paginated } from '@unipods/types';
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
import { RefreshCw, Trash2, Video } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { isInFlight, StatusBadge } from '@/components/status-badge';
import { UploadDialog } from '@/components/upload-dialog';
import { meetingsApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate, formatDuration } from '@/lib/format';

export default function MeetingsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const query = useQuery<Paginated<MeetingDto>>({
    queryKey: ['meetings', debounced],
    queryFn: () => meetingsApi.list({ limit: 50, search: debounced || undefined }),
    refetchInterval: (result) =>
      result.state.data?.items.some((meeting) => isInFlight(meeting.status)) ? 2500 : false,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['meetings'] });

  const reprocess = useMutation({
    mutationFn: (id: string) => meetingsApi.process(id),
    onSuccess: () => {
      toast.success('Re-queued for processing');
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => meetingsApi.remove(id),
    onSuccess: () => {
      toast.success('Meeting deleted');
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recordings and transcripts, searchable down to the moment something was said.
          </p>
        </div>
        {isAdmin ? (
          <UploadDialog
            triggerLabel="Add meeting"
            title="Add a meeting"
            description="Upload a recording to transcribe it, or create the meeting now and import an existing transcript on its page."
            accept=".mp3,.wav,.m4a,.mp4,.webm,.mov"
            fileLabel="Recording (optional)"
            fileRequired={false}
            submitLabel="Create meeting"
            fields={[
              { name: 'title', label: 'Title', required: true, placeholder: 'AI Architecture Meeting' },
              { name: 'description', label: 'Description', type: 'textarea' },
              {
                name: 'meetingDate',
                label: 'When it happened',
                type: 'datetime-local',
                required: true,
                defaultValue: new Date().toISOString().slice(0, 16),
              },
            ]}
            onSubmit={async (form) => {
              const when = form.get('meetingDate');
              if (typeof when === 'string' && when) {
                form.set('meetingDate', new Date(when).toISOString());
              }
              await meetingsApi.create(form);
            }}
            onDone={invalidate}
          />
        ) : null}
      </div>

      <div className="mt-6">
        <label htmlFor="meeting-search" className="sr-only">
          Filter meetings
        </label>
        <Input
          id="meeting-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by title or description…"
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
          <EmptyState title="Could not load meetings" description={describeError(query.error)} />
        ) : query.data && query.data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meeting</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Length</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transcript</TableHead>
                <TableHead>Summary</TableHead>
                {isAdmin ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((meeting) => (
                <TableRow key={meeting.id}>
                  <TableCell>
                    <Link
                      href={`/meetings/${meeting.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {meeting.title}
                    </Link>
                    {meeting.status === 'FAILED' && meeting.statusMessage ? (
                      <span className="mt-1 block text-xs text-destructive">
                        {meeting.statusMessage}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(meeting.meetingDate)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDuration(meeting.durationSeconds)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={meeting.status} />
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {meeting.transcriptSegments > 0
                      ? `${meeting.transcriptSegments} segments`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-xs">{meeting.hasSummary ? 'Ready' : '—'}</TableCell>
                  {isAdmin ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reprocess ${meeting.title}`}
                          loading={reprocess.isPending && reprocess.variables === meeting.id}
                          onClick={() => reprocess.mutate(meeting.id)}
                        >
                          <RefreshCw aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${meeting.title}`}
                          onClick={() => {
                            if (window.confirm(`Delete “${meeting.title}” and its transcript?`)) {
                              remove.mutate(meeting.id);
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
            icon={<Video className="size-8" />}
            title={debounced ? 'No meetings match that filter' : 'No meetings yet'}
            description={
              isAdmin
                ? 'Add a meeting and upload its recording, or import a transcript your conferencing tool already produced.'
                : 'An administrator has not added any meetings yet.'
            }
          />
        )}
      </div>
    </div>
  );
}
