'use client';

import type { Paginated, QuestionStatus, UnansweredQuestionDto } from '@unipods/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@unipods/ui';
import { CheckCircle2, EyeOff, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatRelative } from '@/lib/format';

const FILTERS: Array<{ value: QuestionStatus | 'ALL'; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ANSWERED', label: 'Answered' },
  { value: 'IGNORED', label: 'Ignored' },
  { value: 'ALL', label: 'All' },
];

export default function AdminQuestionsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<QuestionStatus | 'ALL'>('OPEN');

  const query = useQuery<Paginated<UnansweredQuestionDto>>({
    queryKey: ['admin', 'unanswered', filter],
    queryFn: () =>
      adminApi.unanswered({ limit: 50, status: filter === 'ALL' ? undefined : filter }),
  });

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuestionStatus }) =>
      adminApi.updateQuestion(id, { status }),
    onSuccess: () => {
      toast.success('Question updated');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'unanswered'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div>
      <h2 className="text-lg font-semibold">Information gaps</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Questions the knowledge base could not answer, grouped so paraphrases of the same question
        count together. Each one is a thing your community has not written down anywhere.
      </p>

      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
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

      <div className="mt-4">
        {query.isLoading ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState title="Could not load questions" description={describeError(query.error)} />
        ) : query.data && query.data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Asked</TableHead>
                <TableHead>Last asked</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((question) => (
                <TableRow key={question.id}>
                  <TableCell className="max-w-md">
                    <span className="font-medium">{question.question}</span>
                    {question.resolutionNote ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {question.resolutionNote}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums font-semibold">{question.count}×</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatRelative(question.lastAskedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        question.status === 'ANSWERED'
                          ? 'success'
                          : question.status === 'IGNORED'
                            ? 'outline'
                            : 'warning'
                      }
                    >
                      {question.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Search the knowledge base for: ${question.question}`}
                        asChild
                      >
                        <Link href={`/search?q=${encodeURIComponent(question.question)}`}>
                          <Search aria-hidden />
                        </Link>
                      </Button>
                      {question.status !== 'ANSWERED' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Mark as answered"
                          onClick={() => update.mutate({ id: question.id, status: 'ANSWERED' })}
                        >
                          <CheckCircle2 aria-hidden />
                        </Button>
                      ) : null}
                      {question.status !== 'IGNORED' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Ignore this question"
                          onClick={() => update.mutate({ id: question.id, status: 'IGNORED' })}
                        >
                          <EyeOff aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title={filter === 'OPEN' ? 'No open gaps' : 'Nothing here'}
            description={
              filter === 'OPEN'
                ? 'Every question asked so far has been answerable from the knowledge base.'
                : 'Try a different status filter.'
            }
          />
        )}
      </div>
    </div>
  );
}
