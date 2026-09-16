'use client';

import type { MessageDto, Paginated } from '@unipods/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { MessageCircle, Trash2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { UploadDialog } from '@/components/upload-dialog';
import { messagesApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';

export default function AdminMessagesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [channel, setChannel] = React.useState<string>('');

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const channels = useQuery({ queryKey: ['message-channels'], queryFn: messagesApi.channels });

  const query = useQuery<Paginated<MessageDto>>({
    queryKey: ['messages', debounced, channel],
    queryFn: () =>
      messagesApi.list({
        limit: 50,
        search: debounced || undefined,
        channel: channel || undefined,
      }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['messages'] });
    void queryClient.invalidateQueries({ queryKey: ['message-channels'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => messagesApi.remove(id),
    onSuccess: () => {
      toast.success('Message deleted');
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Messages</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Chat history imported from a Telegram export, JSON, CSV or a plain-text log.
          </p>
        </div>
        <UploadDialog
          triggerLabel="Import messages"
          title="Import messages"
          description="Parsing happens immediately so you see exactly what was read; embedding runs in the background."
          accept=".json,.csv,.txt"
          fileLabel="Export file"
          submitLabel="Import"
          fields={[
            {
              name: 'format',
              label: 'Format',
              type: 'select',
              required: true,
              defaultValue: 'json',
              options: [
                { value: 'telegram', label: 'Telegram Desktop export (result.json)' },
                { value: 'json', label: 'JSON array of messages' },
                { value: 'csv', label: 'CSV with a header row' },
                { value: 'txt', label: 'Plain-text chat log' },
              ],
            },
            {
              name: 'channel',
              label: 'Channel name',
              placeholder: 'general',
              hint: 'Required for plain-text logs, and for files without a channel column.',
            },
          ]}
          onSubmit={async (form) => {
            const result = await messagesApi.import(form);
            toast.success(
              `${result.imported} imported, ${result.skipped} already present${
                result.warnings.length > 0 ? `, ${result.warnings.length} skipped rows` : ''
              }`,
            );
          }}
          onDone={invalidate}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="message-search" className="sr-only">
            Filter messages
          </label>
          <Input
            id="message-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by message text…"
          />
        </div>
        <div>
          <label htmlFor="channel-filter" className="sr-only">
            Channel
          </label>
          <select
            id="channel-filter"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All channels</option>
            {channels.data?.map((entry) => (
              <option key={entry.channel} value={entry.channel}>
                {entry.channel} ({entry.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        {query.isLoading ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState title="Could not load messages" description={describeError(query.error)} />
        ) : query.data && query.data.items.length > 0 ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {query.data.total} message{query.data.total === 1 ? '' : 's'}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Message</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((message) => (
                  <TableRow key={message.id}>
                    <TableCell className="max-w-md">
                      <span className="block font-medium">{message.authorName}</span>
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {message.content}
                      </span>
                      {message.isAnnouncement ? (
                        <Badge variant="outline" className="mt-1">
                          Announcement
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{message.channel}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(message.messageDate)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete message"
                        onClick={() => {
                          if (window.confirm('Delete this message from the knowledge base?')) {
                            remove.mutate(message.id);
                          }
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <EmptyState
            icon={<MessageCircle className="size-8" />}
            title="No messages imported yet"
            description="Import a chat export and the assistant can answer from what your community has already discussed."
          />
        )}
      </div>
    </div>
  );
}
