'use client';

import type { ConversationSummary } from '@unipods/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton, cn } from '@unipods/ui';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { chatApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatRelative } from '@/lib/format';

/** Conversation list. Hidden below `lg` so the chat itself owns a phone screen. */
export function ConversationSidebar({ activeId }: { activeId?: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const conversations = useQuery<ConversationSummary[]>({
    queryKey: ['conversations'],
    queryFn: chatApi.conversations,
  });

  const remove = useMutation({
    mutationFn: (id: string) => chatApi.remove(id),
    onSuccess: (_result, id) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation deleted');
      if (id === activeId) router.push('/chat');
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <aside className="hidden w-64 shrink-0 lg:block" aria-label="Conversations">
      <Button asChild variant="outline" className="w-full justify-start">
        <Link href="/chat">
          <MessageSquarePlus aria-hidden />
          New conversation
        </Link>
      </Button>

      <h2 className="mt-6 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recent
      </h2>

      {conversations.isLoading ? (
        <div className="mt-2 space-y-2" aria-hidden>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-12 w-full" />
          ))}
        </div>
      ) : conversations.data && conversations.data.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {conversations.data.map((conversation) => (
            <li key={conversation.id} className="group relative">
              <Link
                href={`/chat/${conversation.id}`}
                aria-current={conversation.id === activeId ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 pr-9 text-sm transition-colors',
                  conversation.id === activeId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                <span className="line-clamp-1 font-medium">{conversation.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {formatRelative(conversation.updatedAt)} · {conversation.messageCount} messages
                </span>
              </Link>
              <button
                type="button"
                onClick={() => remove.mutate(conversation.id)}
                aria-label={`Delete conversation ${conversation.title}`}
                className="absolute right-1.5 top-2 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 px-1 text-sm text-muted-foreground">
          Your conversations will appear here.
        </p>
      )}
    </aside>
  );
}
