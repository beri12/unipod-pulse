'use client';

import type { AdminStats, SystemStatus } from '@unipods/types';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@unipods/ui';
import { CircleAlert, CircleCheck, FileText, MessageCircle, Layers, Video } from 'lucide-react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';
import { describeError } from '@/lib/errors';

export default function AdminDashboardPage() {
  const stats = useQuery<AdminStats>({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats });
  const status = useQuery<SystemStatus>({
    queryKey: ['admin', 'status'],
    queryFn: adminApi.status,
    refetchInterval: 15_000,
  });

  if (stats.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28" />
        ))}
      </div>
    );
  }

  if (stats.isError || !stats.data) {
    return <EmptyState title="Could not load statistics" description={describeError(stats.error)} />;
  }

  const data = stats.data;
  const answeredShare =
    data.questions.total > 0
      ? Math.round((data.questions.answered / data.questions.total) * 100)
      : 0;

  return (
    <div className="space-y-8">
      <section aria-label="Knowledge base">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<FileText className="size-4" aria-hidden />}
            label="Documents"
            value={data.documents.total}
            detail={`${data.documents.completed} indexed · ${data.documents.pending} in progress${
              data.documents.failed > 0 ? ` · ${data.documents.failed} failed` : ''
            }`}
            href="/admin/documents"
            alert={data.documents.failed > 0}
          />
          <StatCard
            icon={<Video className="size-4" aria-hidden />}
            label="Meetings"
            value={data.meetings.total}
            detail={`${data.meetings.completed} indexed · ${data.meetings.pending} in progress${
              data.meetings.failed > 0 ? ` · ${data.meetings.failed} failed` : ''
            }`}
            href="/admin/meetings"
            alert={data.meetings.failed > 0}
          />
          <StatCard
            icon={<MessageCircle className="size-4" aria-hidden />}
            label="Messages"
            value={data.messages.total}
            detail={`${data.messages.announcements} announcements`}
            href="/admin/messages"
          />
          <StatCard
            icon={<Layers className="size-4" aria-hidden />}
            label="Knowledge chunks"
            value={data.knowledge.chunks}
            detail={
              data.knowledge.pendingEmbeddings > 0
                ? `${data.knowledge.pendingEmbeddings} awaiting embedding`
                : 'All embedded'
            }
            href="/admin/knowledge"
            alert={data.knowledge.pendingEmbeddings > 0}
          />
        </div>
      </section>

      <section aria-label="Questions">
        <h2 className="text-sm font-medium">Questions</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Asked today" value={data.questions.today} />
          <StatCard
            label="Answered"
            value={data.questions.answered}
            detail={`${answeredShare}% of all questions`}
          />
          <StatCard
            label="Unanswered"
            value={data.questions.unanswered}
            detail="Recorded as information gaps"
            alert={data.questions.unanswered > 0}
          />
          <StatCard
            label="Open gaps"
            value={data.questions.openUnansweredGroups}
            detail="Distinct questions to answer"
            href="/admin/questions"
          />
        </div>
      </section>

      <section aria-label="System status">
        <h2 className="text-sm font-medium">System status</h2>
        {status.isLoading ? (
          <Skeleton className="mt-3 h-40" />
        ) : status.data ? (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {status.data.status === 'ok' ? (
                    <CircleCheck className="size-4 text-success" aria-hidden />
                  ) : (
                    <CircleAlert className="size-4 text-destructive" aria-hidden />
                  )}
                  Services
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {status.data.services.map((service) => (
                  <div key={service.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="capitalize">{service.name}</span>
                    <span className="flex items-center gap-2">
                      {service.latencyMs !== null ? (
                        <span className="text-xs text-muted-foreground">{service.latencyMs} ms</span>
                      ) : null}
                      <Badge variant={service.status === 'ok' ? 'success' : 'destructive'}>
                        {service.status === 'ok' ? 'OK' : 'Error'}
                      </Badge>
                    </span>
                  </div>
                ))}
                <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                  <p>
                    AI provider: <strong>{status.data.ai.provider}</strong>
                  </p>
                  <p>Chat model: {status.data.ai.chatModel}</p>
                  <p>Embeddings: {status.data.ai.embeddingModel}</p>
                  <p>Transcription: {status.data.ai.transcriptionModel}</p>
                  <p className="mt-1">
                    Uptime {Math.floor(status.data.uptimeSeconds / 60)} min · version{' '}
                    {status.data.version}
                    {status.data.demoMode ? ' · demo mode' : ''}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Background queues</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Queue</TableHead>
                      <TableHead>Waiting</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.data.queues.map((queue) => (
                      <TableRow key={queue.name}>
                        <TableCell className="font-mono text-xs">{queue.name}</TableCell>
                        <TableCell className="tabular-nums">{queue.waiting}</TableCell>
                        <TableCell className="tabular-nums">{queue.active}</TableCell>
                        <TableCell
                          className={`tabular-nums ${queue.failed > 0 ? 'text-destructive' : ''}`}
                        >
                          {queue.failed}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ) : (
          <EmptyState className="mt-3" title="Status unavailable" />
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  href,
  alert = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  detail?: string;
  href?: string;
  alert?: boolean;
}) {
  const body = (
    <Card className={href ? 'transition-colors hover:border-ring' : undefined}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
        {detail ? (
          <p className={`mt-1 text-xs ${alert ? 'text-warning' : 'text-muted-foreground'}`}>
            {detail}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
