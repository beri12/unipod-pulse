'use client';

import type { MeetingDetail } from '@unipods/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@unipods/ui';
import { ArrowLeft, CalendarClock, CheckSquare, HelpCircle, ListChecks, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Suspense } from 'react';
import { useAuth } from '@/components/providers';
import { isInFlight, StatusBadge } from '@/components/status-badge';
import { UploadDialog } from '@/components/upload-dialog';
import { meetingsApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate, formatDuration, formatTimestamp } from '@/lib/format';

function MeetingDetailInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const id = params.id;

  /** A citation deep-links with ?t=<seconds>; that segment is highlighted. */
  const jumpTo = Number.parseInt(searchParams.get('t') ?? '', 10);
  const [transcriptFilter, setTranscriptFilter] = React.useState('');
  const mediaRef = React.useRef<HTMLAudioElement | null>(null);

  const query = useQuery<MeetingDetail>({
    queryKey: ['meeting', id],
    queryFn: () => meetingsApi.byId(id),
    refetchInterval: (result) =>
      result.state.data && isInFlight(result.state.data.status) ? 2500 : false,
  });

  React.useEffect(() => {
    if (!query.data || Number.isNaN(jumpTo)) return;
    const handle = window.setTimeout(() => {
      document.getElementById(`segment-${jumpTo}`)?.scrollIntoView({ block: 'center' });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [query.data, jumpTo]);

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8" aria-busy>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-4 h-40 w-full" />
        <Skeleton className="mt-4 h-72 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <EmptyState
          title="Could not load this meeting"
          description={query.error ? describeError(query.error) : undefined}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/meetings">Back to meetings</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const meeting = query.data;
  const summary = meeting.summary;
  const filtered = transcriptFilter.trim()
    ? meeting.transcript.filter((segment) =>
        segment.content.toLowerCase().includes(transcriptFilter.trim().toLowerCase()),
      )
    : meeting.transcript;

  /** Seeks the player when a timestamp is clicked, if there is media. */
  const seek = (seconds: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = seconds;
    void media.play().catch(() => undefined);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/meetings">
          <ArrowLeft aria-hidden />
          Meetings
        </Link>
      </Button>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={meeting.status} />
          {meeting.isDemo ? <Badge variant="warning">Demo content</Badge> : null}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{meeting.title}</h1>
        {meeting.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{meeting.description}</p>
        ) : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden />
            {formatDate(meeting.meetingDate)}
          </span>
          <span>{formatDuration(meeting.durationSeconds)}</span>
          <span>{meeting.transcriptSegments} transcript segments</span>
          <span>{meeting.chunkCount} indexed passages</span>
        </p>
      </header>

      {meeting.status === 'FAILED' && meeting.statusMessage ? (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {meeting.statusMessage}
        </p>
      ) : null}

      {meeting.mediaUrl ? (
        <audio ref={mediaRef} controls src={meeting.mediaUrl} className="mt-4 w-full">
          <track kind="captions" />
        </audio>
      ) : null}

      {isAdmin && meeting.transcript.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm font-medium">This meeting has no transcript yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Import one your conferencing tool already produced — WebVTT, SubRip, JSON or timestamped
            text. No speech-to-text provider is needed for that.
          </p>
          <div className="mt-3">
            <UploadDialog
              triggerLabel="Import transcript"
              title="Import a transcript"
              description="Timestamps are preserved so citations point at the exact moment."
              accept=".vtt,.srt,.json,.txt"
              fileLabel="Transcript file (.vtt, .srt, .json or .txt)"
              submitLabel="Import"
              onSubmit={(form) => meetingsApi.importTranscript(id, form)}
              onDone={() => void queryClient.invalidateQueries({ queryKey: ['meeting', id] })}
            />
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="summary" className="mt-8">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          {summary ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>TL;DR</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{summary.tldr || 'No summary text.'}</p>
                  {summary.topics.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {summary.topics.map((topic) => (
                        <li key={topic}>
                          <Badge variant="outline">{topic}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>

              <SummaryList
                title="Key decisions"
                icon={<CheckSquare className="size-4" aria-hidden />}
                items={summary.decisions.map((decision) => ({
                  text: decision.text,
                  startTime: decision.startTime,
                }))}
                emptyText="No decisions were recorded in this transcript."
                onSeek={meeting.mediaUrl ? seek : undefined}
              />

              <SummaryList
                title="Action items"
                icon={<ListChecks className="size-4" aria-hidden />}
                items={summary.actionItems.map((item) => ({
                  text: item.text,
                  startTime: item.startTime,
                  meta: [item.owner ? `Owner: ${item.owner}` : null, item.due ? `Due: ${item.due}` : null]
                    .filter(Boolean)
                    .join(' · '),
                }))}
                emptyText="No action items were recorded."
                onSeek={meeting.mediaUrl ? seek : undefined}
              />

              {summary.deadlines.length > 0 ? (
                <SummaryList
                  title="Deadlines"
                  icon={<CalendarClock className="size-4" aria-hidden />}
                  items={summary.deadlines.map((deadline) => ({
                    text: deadline.text,
                    meta: deadline.date ?? undefined,
                  }))}
                  emptyText=""
                />
              ) : null}

              {summary.openQuestions.length > 0 ? (
                <SummaryList
                  title="Open questions"
                  icon={<HelpCircle className="size-4" aria-hidden />}
                  items={summary.openQuestions.map((question) => ({ text: question }))}
                  emptyText=""
                />
              ) : null}

              {summary.generatedBy ? (
                <p className="text-xs text-muted-foreground">
                  Summarised by {summary.generatedBy.provider} ({summary.generatedBy.model}). Every
                  point above is checkable against the transcript below.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title={isInFlight(meeting.status) ? 'Summary is being generated' : 'No summary yet'}
              description={
                isInFlight(meeting.status)
                  ? 'This page updates itself when processing finishes.'
                  : 'Import or transcribe a transcript, then reprocess the meeting.'
              }
            />
          )}
        </TabsContent>

        <TabsContent value="transcript">
          {meeting.transcript.length === 0 ? (
            <EmptyState
              title="No transcript yet"
              description="Upload a recording to transcribe it, or import an existing transcript."
            />
          ) : (
            <>
              <label htmlFor="transcript-search" className="sr-only">
                Search the transcript
              </label>
              <Input
                id="transcript-search"
                value={transcriptFilter}
                onChange={(event) => setTranscriptFilter(event.target.value)}
                placeholder="Search the transcript…"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {filtered.length} of {meeting.transcript.length} segments
              </p>
              <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
                {filtered.map((segment) => {
                  const active = !Number.isNaN(jumpTo) && Math.abs(segment.startTime - jumpTo) < 1;
                  return (
                    <li
                      key={segment.id}
                      id={`segment-${Math.round(segment.startTime)}`}
                      className={cn('flex gap-3 p-3', active && 'bg-accent/50')}
                    >
                      <button
                        type="button"
                        onClick={() => seek(segment.startTime)}
                        disabled={!meeting.mediaUrl}
                        className="h-fit shrink-0 rounded px-1.5 py-0.5 font-mono text-xs text-primary enabled:hover:bg-accent disabled:cursor-default disabled:text-muted-foreground"
                        aria-label={`Jump to ${formatTimestamp(segment.startTime)}`}
                      >
                        {meeting.mediaUrl ? (
                          <Play className="mr-1 inline size-3" aria-hidden />
                        ) : null}
                        {formatTimestamp(segment.startTime)}
                      </button>
                      <p className="text-sm leading-relaxed">
                        {segment.speaker ? (
                          <span className="font-medium">{segment.speaker}: </span>
                        ) : null}
                        {segment.content}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryList({
  title,
  icon,
  items,
  emptyText,
  onSeek,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ text: string; startTime?: number; meta?: string }>;
  emptyText: string;
  onSeek?: (seconds: number) => void;
}) {
  if (items.length === 0 && !emptyText) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item, index) => (
              <li key={index} className="flex gap-2 text-sm leading-relaxed">
                {typeof item.startTime === 'number' ? (
                  <button
                    type="button"
                    onClick={() => onSeek?.(item.startTime as number)}
                    disabled={!onSeek}
                    className="h-fit shrink-0 rounded px-1 font-mono text-xs text-primary enabled:hover:bg-accent disabled:cursor-default disabled:text-muted-foreground"
                  >
                    {formatTimestamp(item.startTime)}
                  </button>
                ) : null}
                <span>
                  {item.text}
                  {item.meta ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.meta}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function MeetingDetailPage() {
  return (
    <Suspense fallback={null}>
      <MeetingDetailInner />
    </Suspense>
  );
}
