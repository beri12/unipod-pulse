'use client';

import type { Citation, SourceKind, SourceLocator, SourceRef } from '@unipods/types';
import { Badge, cn } from '@unipods/ui';
import { FileText, MessageCircle, Megaphone, Video } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { describeLocation, formatDate, SOURCE_LABELS } from '@/lib/format';

const ICONS: Record<SourceKind, React.ComponentType<{ className?: string }>> = {
  DOCUMENT: FileText,
  MEETING: Video,
  MESSAGE: MessageCircle,
  ANNOUNCEMENT: Megaphone,
};

/**
 * Where a citation links to. Meetings deep-link to the cited moment and
 * documents to the cited chunk, so "open source" lands on the evidence rather
 * than the top of a long page.
 */
export function sourceHref(source: SourceRef, locator: SourceLocator = {}): string | null {
  switch (source.type) {
    case 'DOCUMENT':
      return `/documents/${source.referenceId}${
        typeof locator.chunkIndex === 'number' ? `#chunk-${locator.chunkIndex}` : ''
      }`;
    case 'MEETING':
      return `/meetings/${source.referenceId}${
        typeof locator.startTime === 'number' ? `?t=${Math.floor(locator.startTime)}` : ''
      }`;
    case 'MESSAGE':
    case 'ANNOUNCEMENT':
      return `/search?q=${encodeURIComponent(source.title)}&types=${source.type}`;
    default:
      return null;
  }
}

export interface SourceCardProps {
  source: SourceRef;
  locator?: SourceLocator;
  quote?: string | null;
  score?: number;
  /** Card number, matching the [n] marker in the answer text. */
  index?: number;
  className?: string;
}

export function SourceCard({ source, locator = {}, quote, score, index, className }: SourceCardProps) {
  const Icon = ICONS[source.type] ?? FileText;
  const position = describeLocation(source.type, { ...source.metadata, ...locator });
  const href = sourceHref(source, { ...source.metadata, ...locator });
  // Message positions already end in the message's date; printing the source
  // date after it would show the same day twice.
  const showDate = Boolean(source.occurredAt) && !position.includes(formatDate(source.occurredAt));

  const body = (
    <>
      <div className="flex items-start gap-2">
        {typeof index === 'number' ? (
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-accent text-[11px] font-semibold text-accent-foreground">
            {index}
          </span>
        ) : null}
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{source.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{SOURCE_LABELS[source.type]}</span>
            {position ? (
              <>
                <span aria-hidden>·</span>
                <span>{position}</span>
              </>
            ) : null}
            {showDate ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatDate(source.occurredAt)}</span>
              </>
            ) : null}
          </p>
        </div>
        {typeof score === 'number' ? (
          <Badge variant="outline" title="Retrieval score for this passage">
            {score.toFixed(2)}
          </Badge>
        ) : null}
      </div>

      {quote ? (
        <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          “{quote}”
        </blockquote>
      ) : null}
    </>
  );

  const classes = cn(
    'block rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-ring',
    className,
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** The citation list rendered under an assistant answer. */
export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <section aria-label="Sources" className="mt-3 space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {citations.length === 1 ? 'Source' : `Sources (${citations.length})`}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {citations.map((citation, index) => (
          <li key={citation.id}>
            <SourceCard
              source={citation.source}
              locator={citation.metadata}
              quote={citation.quote}
              score={citation.score}
              index={index + 1}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
