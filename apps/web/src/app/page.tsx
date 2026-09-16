'use client';

import { Button } from '@unipods/ui';
import { FileText, MessageCircle, Search, ShieldCheck, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { PulseMark } from '@/components/app-shell';
import { useAuth } from '@/components/providers';

/**
 * Landing page. A signed-in visitor is sent straight to the assistant; everyone
 * else gets a short explanation of what the product actually does.
 */
export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && user) router.replace('/chat');
  }, [loading, user, router]);

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-16 sm:py-24">
      <div className="flex flex-col items-center text-center">
        <PulseMark className="size-12" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">UniPods Pulse</h1>
        <p className="mt-2 text-lg text-muted-foreground">Your community. One intelligent memory.</p>
        <p className="mt-6 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          Community knowledge ends up scattered across group chats, call recordings, shared
          documents and announcements, so people ask the same question over and over. UniPods Pulse
          turns all of it into one searchable memory you can ask questions of — and every answer
          shows the source it came from.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/register">Create an account</Link>
          </Button>
        </div>
      </div>

      <ul className="mt-16 grid gap-4 sm:grid-cols-2">
        <Feature
          icon={<MessageCircle className="size-5" aria-hidden />}
          title="Ask in plain language"
          body="“When is the deadline?” or “What did we decide?” — answered from your community's own records, never from guesswork."
        />
        <Feature
          icon={<ShieldCheck className="size-5" aria-hidden />}
          title="Answers you can check"
          body="Every claim carries a citation to the document page, meeting timestamp or message it came from. When the evidence is not there, it says so."
        />
        <Feature
          icon={<Video className="size-5" aria-hidden />}
          title="Meetings become searchable"
          body="Upload a recording or an existing transcript. Decisions, action items and deadlines are pulled out with the timestamp they were said at."
        />
        <Feature
          icon={<FileText className="size-5" aria-hidden />}
          title="Documents and chat, together"
          body="Import PDFs, Word files, Markdown and chat exports. One question searches all of them at once."
        />
      </ul>

      <div className="mt-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Search className="size-4" aria-hidden />
        Already a member? Everything is behind your community sign-in.
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-primary">{icon}</div>
      <h2 className="mt-3 text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}
