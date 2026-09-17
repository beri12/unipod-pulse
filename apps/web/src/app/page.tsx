'use client';

import { Badge, Button } from '@unipods/ui';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  MessageCircle,
  Quote,
  Search,
  Send,
  ShieldCheck,
  Video,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { PulseMark } from '@/components/app-shell';
import { useAuth } from '@/components/providers';

/**
 * Landing page.
 *
 * A signed-in visitor is sent straight to the assistant; everyone else gets the
 * case for the product. The claims here are deliberately the ones the system
 * actually delivers — citations, refusal, timestamps — because a landing page
 * that promises more than the demo shows is the fastest way to lose the room.
 */
export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && user) router.replace('/chat');
  }, [loading, user, router]);

  return (
    <main id="main" className="w-full">
      <Hero />
      <Problem />
      <HowItWorks />
      <Guarantees />
      <WhereItLives />
      <Closing />
    </main>
  );
}

function Hero() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-16 pt-16 sm:pt-24">
      <div className="flex flex-col items-center text-center">
        <PulseMark className="size-12" />
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">UniPods Pulse</h1>
        <p className="mt-3 text-lg text-muted-foreground sm:text-xl">
          Your community. One intelligent memory.
        </p>
        <p className="mt-6 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
          Group chats move faster than anyone can read. Meetings happen without you. The answer to
          your question was posted three days ago, four hundred messages up. Pulse reads all of it —
          chats, call transcripts, documents, announcements — and answers in plain language, always
          showing where the answer came from.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/register">
              Get started <ArrowRight className="ml-2 size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>

      <ExampleAnswer />
    </section>
  );
}

/**
 * A real answer in the shape the product actually produces: a direct reply, a
 * bracket marker, and a checkable source underneath.
 */
function ExampleAnswer() {
  return (
    <div className="mx-auto mt-14 max-w-2xl rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-sm font-medium">“What did we decide about the API framework?”</p>
      <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm leading-relaxed">
        <p>
          The team decided to use NestJS rather than Express, because the dependency injection and
          module structure keep the codebase navigable as it grows. <Marker>1</Marker>
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-background p-3 text-xs">
          <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-medium">AI Architecture Meeting — 32:15</p>
            <p className="mt-1 text-muted-foreground">
              “Let&apos;s go with NestJS. The DI and the module boundaries are what will keep this
              readable in three months.”
            </p>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Every claim carries a marker. Every marker resolves to a passage that really exists.
      </p>
    </div>
  );
}

function Marker({ children }: { children: React.ReactNode }) {
  return (
    <sup className="ml-0.5 rounded bg-primary/10 px-1 text-[0.65rem] font-semibold text-primary">
      [{children}]
    </sup>
  );
}

function Problem() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="mx-auto w-full max-w-5xl px-4 py-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          What happens when a group gets big
        </h2>
        <ul className="mt-10 grid gap-6 sm:grid-cols-3">
          <Symptom
            title="Messages get missed"
            body="Traffic outruns attention. People scroll past the one message that mattered and never see it again."
          />
          <Symptom
            title="The same question, again"
            body="Answered questions get asked again a week later, because searching a chat history is harder than asking."
          />
          <Symptom
            title="Meetings vanish"
            body="Miss the call and the decision is gone. Nobody rewatches a ninety-minute recording to find one sentence."
          />
        </ul>
      </div>
    </section>
  );
}

function Symptom({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}

function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16">
      <h2 className="text-center text-2xl font-semibold tracking-tight">How it works</h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
        Everything the community produces becomes one searchable memory, and every answer is traced
        back to it.
      </p>

      <ol className="mt-12 grid gap-8 sm:grid-cols-3">
        <Step
          number={1}
          icon={<FileText className="size-5" aria-hidden />}
          title="Bring the knowledge in"
          body="PDFs, Word files, Markdown, chat exports, meeting transcripts. Text is extracted with its page number or timestamp kept intact."
        />
        <Step
          number={2}
          icon={<Search className="size-5" aria-hidden />}
          title="Find the right passage"
          body="Meaning-based search and keyword search run together, then get re-ranked by how recent and how relevant each passage is."
        />
        <Step
          number={3}
          icon={<MessageCircle className="size-5" aria-hidden />}
          title="Answer, with receipts"
          body="The answer is written only from retrieved passages. Citations are resolved in code against what was actually retrieved."
        />
      </ol>
    </section>
  );
}

function Step({
  number,
  icon,
  title,
  body,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {number}
        </span>
        <span className="text-primary">{icon}</span>
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}

function Guarantees() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="mx-auto w-full max-w-5xl px-4 py-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          What it will never do
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
          An assistant that invents a deadline is worse than no assistant. These are enforced in
          code, not asked for in a prompt.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          <Guarantee
            icon={<ShieldCheck className="size-5" aria-hidden />}
            title="Never answer without a source"
            body="Citation markers are matched against the passages that were retrieved. A marker pointing at nothing is removed, and an answer left with no citation is replaced by a refusal."
          />
          <Guarantee
            icon={<CheckCircle2 className="size-5" aria-hidden />}
            title="Say so when it doesn't know"
            body="“I couldn't find a confirmed answer in the available community information.” No guessing, no plausible-sounding filler."
          />
          <Guarantee
            icon={<CalendarClock className="size-5" aria-hidden />}
            title="Surface conflicts, not hide them"
            body="When two sources disagree about a date, both are reported with their dates, so a human can decide which is current."
          />
          <Guarantee
            icon={<Video className="size-5" aria-hidden />}
            title="Point at the exact moment"
            body="A meeting citation carries the timestamp the sentence was said at. A document citation carries the page. Both are checkable in seconds."
          />
        </ul>
      </div>
    </section>
  );
}

function Guarantee({
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
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}

function WhereItLives() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16">
      <h2 className="text-center text-2xl font-semibold tracking-tight">
        It comes to where you already talk
      </h2>

      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        <Channel
          icon={<Send className="size-5" aria-hidden />}
          title="Telegram"
          status="Live in the group"
          body="Add the bot to your group. It reads along quietly and answers when asked — by /ask, by @mention, or by replying to it. Answers carry the same citations as the web app."
          available
        />
        <Channel
          icon={<MessageCircle className="size-5" aria-hidden />}
          title="WhatsApp"
          status="By chat export"
          body="WhatsApp's business API cannot read group messages, so a bot cannot sit in a WhatsApp group. Export the chat instead and upload it — the history becomes searchable all the same."
        />
        <Channel
          icon={<Search className="size-5" aria-hidden />}
          title="The web app"
          body="Ask, search, catch up on what you missed, and manage what the community knows. Admins can see which questions people ask that nothing answers."
          status="Full workspace"
          available
        />
      </div>

      <div className="mx-auto mt-10 max-w-2xl rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">“What did I miss today?”</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          A single question that returns the announcements, decisions and deadlines from any period
          you name — ranked by how much they matter, not by when they were posted. The answer to
          coming back from three days away.
        </p>
      </div>
    </section>
  );
}

function Channel({
  icon,
  title,
  status,
  body,
  available = false,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  body: string;
  available?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-primary">{icon}</span>
        <Badge variant={available ? 'success' : 'outline'}>{status}</Badge>
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Closing() {
  return (
    <section className="border-t border-border bg-muted/30">
      <div className="mx-auto w-full max-w-5xl px-4 py-16 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Stop losing what your group knows</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Every conversation, call and document your community has already had — searchable, and
          answerable, in one place.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/register">
              Create an account <ArrowRight className="ml-2 size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
