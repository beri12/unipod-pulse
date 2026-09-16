import { Inject, Injectable } from '@nestjs/common';
import { LlmService, splitSentences } from '@unipods/ai';
import type { Env } from '@unipods/config';
import type { CatchUpItem, CatchUpResponse, Importance, SourceRef } from '@unipods/types';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { toSourceRef } from '../sources/sources.service';

interface Candidate {
  key: string;
  type: CatchUpItem['type'];
  title: string;
  content: string;
  occurredAt: Date | null;
  source: SourceRef;
}

@Injectable()
export class CatchUpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * "What did I miss?" for a time window.
   *
   * Collects announcements, meetings, documents and discussions that occurred in
   * the window, removes near-duplicates, then summarises. Every item carries the
   * source it came from — the briefing is a view over real records, not a
   * free-text recap.
   */
  async generate(range: { from: Date; to: Date; label: string }): Promise<CatchUpResponse> {
    const candidates = await this.collect(range.from, range.to);
    const deduped = dedupe(candidates);

    if (deduped.length === 0) {
      return {
        period: range.label,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        summary: `Nothing new was recorded ${range.label}.`,
        items: [],
        empty: true,
        generatedBy: { provider: this.llm.providerName, model: this.llm.model },
      };
    }

    const generated = await this.llm.generateCatchUp({
      periodLabel: range.label,
      items: deduped.map((candidate) => ({
        type: candidate.type,
        title: candidate.title,
        content: candidate.content,
        occurredAt: candidate.occurredAt ? candidate.occurredAt.toISOString() : null,
      })),
    });

    const items: CatchUpItem[] = deduped.map((candidate, index) => ({
      id: candidate.key,
      importance: (generated.importance[index] ?? 'low') as Importance,
      type: candidate.type,
      title: candidate.title,
      // Fall back to the record's own first sentence if the model returned an
      // empty summary for this item — never an invented one.
      summary: generated.itemSummaries[index]?.trim() || firstSentence(candidate.content),
      occurredAt: candidate.occurredAt ? candidate.occurredAt.toISOString() : null,
      source: candidate.source,
    }));

    items.sort(byImportanceThenRecency);

    this.logger.event('log', 'catch-up generated', {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      items: items.length,
    });

    return {
      period: range.label,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      summary: generated.summary,
      items,
      empty: false,
      generatedBy: { provider: this.llm.providerName, model: this.llm.model },
    };
  }

  private async collect(from: Date, to: Date): Promise<Candidate[]> {
    const demo = this.env.DEMO_MODE ? { isDemo: true } : { isDemo: false };
    const window = { gte: from, lte: to };

    const [messages, meetings, documents] = await Promise.all([
      this.prisma.message.findMany({
        where: { ...demo, messageDate: window },
        orderBy: [{ isAnnouncement: 'desc' }, { messageDate: 'desc' }],
        take: 120,
        include: { source: true },
      }),
      this.prisma.meeting.findMany({
        where: { ...demo, meetingDate: window },
        orderBy: { meetingDate: 'desc' },
        take: 20,
        include: { source: true },
      }),
      this.prisma.document.findMany({
        where: { ...demo, status: 'COMPLETED', createdAt: window },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { source: true, chunks: { orderBy: { chunkIndex: 'asc' }, take: 1 } },
      }),
    ]);

    const candidates: Candidate[] = [];

    for (const message of messages) {
      if (!message.source) continue;
      candidates.push({
        key: `message:${message.id}`,
        type: message.isAnnouncement ? 'announcement' : 'discussion',
        title: message.isAnnouncement
          ? `Announcement in ${message.channel}`
          : `${message.authorName} in ${message.channel}`,
        content: message.content,
        occurredAt: message.messageDate,
        source: toSourceRef(message.source),
      });
    }

    for (const meeting of meetings) {
      if (!meeting.source) continue;
      const summary = meeting.summary as { tldr?: string; decisions?: unknown[] } | null;
      const decisions = Array.isArray(summary?.decisions) ? summary.decisions.length : 0;
      const duration = meeting.durationSeconds
        ? `${Math.round(meeting.durationSeconds / 60)}-minute meeting. `
        : '';
      candidates.push({
        key: `meeting:${meeting.id}`,
        type: 'meeting',
        title: meeting.title,
        content:
          `${duration}${decisions > 0 ? `${decisions} recorded decision${decisions === 1 ? '' : 's'}. ` : ''}` +
          (summary?.tldr ?? meeting.description ?? 'No summary has been generated yet.'),
        occurredAt: meeting.meetingDate,
        source: toSourceRef(meeting.source),
      });
    }

    for (const document of documents) {
      if (!document.source) continue;
      candidates.push({
        key: `document:${document.id}`,
        type: 'document',
        title: document.title,
        content: document.description ?? document.chunks[0]?.content ?? 'A new resource was added.',
        occurredAt: document.publishedAt ?? document.createdAt,
        source: toSourceRef(document.source),
      });
    }

    return candidates;
  }
}

/** Resolves a `date` / `from` / `to` query into an explicit window. */
export function resolveRange(params: {
  date?: string;
  from?: string;
  to?: string;
  now?: Date;
}): { from: Date; to: Date; label: string } {
  const now = params.now ?? new Date();

  if (params.date) {
    const day = new Date(params.date);
    const start = startOfDay(day);
    const end = endOfDay(day);
    return { from: start, to: end, label: labelForDay(start, now) };
  }

  if (params.from || params.to) {
    const from = params.from ? new Date(params.from) : new Date(now.getTime() - 86_400_000);
    const to = params.to ? new Date(params.to) : now;
    return {
      from,
      to,
      label: `between ${from.toISOString().slice(0, 10)} and ${to.toISOString().slice(0, 10)}`,
    };
  }

  return { from: startOfDay(now), to: endOfDay(now), label: 'today' };
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function labelForDay(day: Date, now: Date): string {
  const today = startOfDay(now).getTime();
  const target = startOfDay(day).getTime();
  if (target === today) return 'today';
  if (target === today - 86_400_000) return 'yesterday';
  return `on ${day.toISOString().slice(0, 10)}`;
}

/**
 * Community chatter repeats itself; three people relaying the same deadline
 * should be one line in a briefing, not three.
 */
function dedupe(candidates: Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  const signatures: Array<Set<string>> = [];

  for (const candidate of candidates) {
    const tokens = new Set(
      candidate.content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 3),
    );
    if (tokens.size === 0) continue;
    const duplicate = signatures.some((previous) => overlap(previous, tokens) > 0.75);
    if (duplicate) continue;
    kept.push(candidate);
    signatures.push(tokens);
    // A briefing longer than this stops being a briefing.
    if (kept.length >= 25) break;
  }
  return kept;
}

function overlap(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared += 1;
  return shared / smaller.size;
}

const IMPORTANCE_ORDER: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

function byImportanceThenRecency(a: CatchUpItem, b: CatchUpItem): number {
  const byImportance = IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance];
  if (byImportance !== 0) return byImportance;
  return (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '');
}

function firstSentence(content: string): string {
  return splitSentences(content)[0]?.slice(0, 240) ?? content.slice(0, 240);
}
