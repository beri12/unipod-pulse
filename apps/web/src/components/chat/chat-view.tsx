'use client';

import type { ChatMessageDto, ChatResponse, ConversationDetail } from '@unipods/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton, Textarea, cn } from '@unipods/ui';
import { AlertCircle, ArrowUp, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { AnswerMeta } from '@/components/chat/answer-meta';
import { ConversationSidebar } from '@/components/chat/conversation-sidebar';
import { CitationList } from '@/components/source-card';
import { chatApi } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatRelative } from '@/lib/format';

const SUGGESTIONS = [
  'What did I miss today?',
  'When is the team declaration deadline?',
  'What did we decide about the AI architecture?',
  'What action items were assigned?',
];

export function ChatView({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState('');
  /** The question in flight, shown optimistically so the UI never feels stuck. */
  const [pending, setPending] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  const conversation = useQuery<ConversationDetail>({
    queryKey: ['conversation', conversationId],
    queryFn: () => chatApi.conversation(conversationId as string),
    enabled: Boolean(conversationId),
  });

  const messages: ChatMessageDto[] = conversation.data?.messages ?? [];

  const ask = useMutation({
    mutationFn: (message: string) =>
      chatApi.ask(conversationId ? { conversationId, message } : { message }),
    onSuccess: (result: ChatResponse) => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (!conversationId) {
        router.push(`/chat/${result.conversationId}`);
      } else {
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      }
    },
    onError: (error) => {
      setPending(null);
      toast.error(describeError(error));
    },
  });

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pending]);

  const submit = (value: string) => {
    const question = value.trim();
    if (!question || ask.isPending) return;
    setDraft('');
    setPending(question);
    ask.mutate(question);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-6">
      <ConversationSidebar activeId={conversationId} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1">
          {conversationId && conversation.isLoading ? (
            <LoadingMessages />
          ) : messages.length === 0 && !pending ? (
            <Welcome onPick={submit} />
          ) : (
            <ol className="space-y-6" aria-live="polite" aria-busy={ask.isPending}>
              {messages.map((message) => (
                <li key={message.id}>
                  <MessageBubble message={message} />
                </li>
              ))}
              {pending ? (
                <>
                  <li>
                    <UserBubble content={pending} />
                  </li>
                  <li>
                    <ThinkingBubble />
                  </li>
                </>
              ) : null}
            </ol>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="sticky bottom-0 mt-6 bg-gradient-to-t from-background via-background to-transparent pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <div className="rounded-xl border border-border bg-card p-2 shadow-sm focus-within:border-ring">
            <label htmlFor="chat-input" className="sr-only">
              Ask UniPods Pulse a question
            </label>
            <Textarea
              id="chat-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter makes a new line.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              placeholder="Ask anything about your community…"
              rows={2}
              maxLength={2000}
              disabled={ask.isPending}
              className="min-h-14 resize-none border-0 bg-transparent focus-visible:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1">
              <p className="text-xs text-muted-foreground">
                Answers are drawn from your community&apos;s own records, with sources.
              </p>
              <Button
                type="submit"
                size="icon"
                loading={ask.isPending}
                disabled={draft.trim().length === 0}
                aria-label="Send question"
              >
                {ask.isPending ? null : <ArrowUp aria-hidden />}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Sparkles className="size-8 text-primary" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Ask UniPods Pulse</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Your community&apos;s intelligent memory. Every answer is grounded in the messages,
        meetings and documents your community already has — and shows you where it came from.
      </p>
      <ul className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => onPick(suggestion)}
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:border-ring"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoadingMessages() {
  return (
    <div className="space-y-6" aria-hidden>
      <Skeleton className="ml-auto h-12 w-2/3 max-w-sm" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}

function UserBubble({ content, createdAt }: { content: string; createdAt?: string }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
      {createdAt ? (
        <span className="mt-1 text-xs text-muted-foreground">{formatRelative(createdAt)}</span>
      ) : null}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <span className="flex gap-1" aria-hidden>
        <Dot delay="0ms" />
        <Dot delay="120ms" />
        <Dot delay="240ms" />
      </span>
      Searching your community&apos;s records…
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
      style={{ animationDelay: delay }}
    />
  );
}

const NO_ANSWER_PREFIX = "I couldn't find a confirmed answer";

function MessageBubble({ message }: { message: ChatMessageDto }) {
  if (message.role === 'USER') {
    return <UserBubble content={message.content} createdAt={message.createdAt} />;
  }

  const unanswered = message.content.startsWith(NO_ANSWER_PREFIX);

  return (
    <div className="animate-rise">
      <div
        className={cn(
          'rounded-2xl rounded-bl-sm border px-4 py-3',
          unanswered ? 'border-warning/40 bg-warning/10' : 'border-border bg-card',
        )}
      >
        {unanswered ? (
          <p className="flex items-start gap-2 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              {message.content}
              <span className="mt-1 block text-muted-foreground">
                This question has been recorded so an organiser can fill the gap.
              </span>
            </span>
          </p>
        ) : (
          <AnswerText content={message.content} />
        )}
        <CitationList citations={message.citations} />
      </div>
      {message.diagnostics ? <AnswerMeta diagnostics={message.diagnostics} /> : null}
    </div>
  );
}

/**
 * Renders the answer as plain text with bullet and paragraph structure
 * preserved. Deliberately not a Markdown renderer: answers quote community
 * content verbatim, and interpreting that as markup could change what a source
 * appears to say.
 */
function AnswerText({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => /^\s*[-*•]\s+/.test(line));
        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex} className="whitespace-pre-wrap break-words">
                  {line.replace(/^\s*[-*•]\s+/, '')}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            {block}
          </p>
        );
      })}
    </div>
  );
}
