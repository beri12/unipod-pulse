import { estimateTokens } from '@unipods/ai';
import { setMessageChunkEmbeddings, type PrismaClient } from '@unipods/database';
import { noopLogger, type IngestDeps, type PipelineResult } from './deps';
import type { NormalizedMessage } from './importers';

export interface PersistResult {
  imported: number;
  skipped: number;
  messageIds: string[];
}

/**
 * Inserts normalised messages, de-duplicating on `(channel, externalId)` so
 * re-importing an updated export does not double-count anything.
 *
 * Takes the client rather than the dependency bundle: storing messages needs no
 * AI provider, and the API runs this inline to report import counts.
 */
export async function persistMessages(
  prisma: PrismaClient,
  messages: NormalizedMessage[],
  options: { isDemo?: boolean } = {},
): Promise<PersistResult> {
  const messageIds: string[] = [];
  let imported = 0;
  let skipped = 0;

  // Messages without an external id cannot be de-duplicated by key, so they are
  // matched on (channel, author, timestamp, content) instead.
  for (const message of messages) {
    const existing = message.externalId
      ? await prisma.message.findUnique({
          where: { channel_externalId: { channel: message.channel, externalId: message.externalId } },
          select: { id: true },
        })
      : await prisma.message.findFirst({
          where: {
            channel: message.channel,
            authorName: message.authorName,
            messageDate: message.messageDate,
            content: message.content,
          },
          select: { id: true },
        });

    if (existing) {
      skipped += 1;
      messageIds.push(existing.id);
      continue;
    }

    const created = await prisma.message.create({
      data: {
        externalId: message.externalId,
        channel: message.channel,
        authorName: message.authorName,
        authorId: message.authorId,
        content: message.content,
        messageDate: message.messageDate,
        isAnnouncement: message.isAnnouncement,
        metadata: message.metadata as object,
        isDemo: options.isDemo ?? false,
      },
      select: { id: true },
    });
    imported += 1;
    messageIds.push(created.id);
  }

  await linkReplies(prisma, messages, messageIds);
  return { imported, skipped, messageIds };
}

/** Resolves `replyToExternalId` to real row ids once every message exists. */
async function linkReplies(
  prisma: PrismaClient,
  messages: NormalizedMessage[],
  messageIds: string[],
): Promise<void> {
  const pending = messages
    .map((message, index) => ({ message, id: messageIds[index] }))
    .filter((entry) => entry.message.replyToExternalId && entry.id);
  if (pending.length === 0) return;

  const externalIds = [...new Set(pending.map((entry) => entry.message.replyToExternalId as string))];
  const channels = [...new Set(pending.map((entry) => entry.message.channel))];
  const targets = await prisma.message.findMany({
    where: { channel: { in: channels }, externalId: { in: externalIds } },
    select: { id: true, channel: true, externalId: true },
  });
  const lookup = new Map(targets.map((target) => [`${target.channel}::${target.externalId}`, target.id]));

  for (const entry of pending) {
    const targetId = lookup.get(`${entry.message.channel}::${entry.message.replyToExternalId}`);
    if (targetId && targetId !== entry.id) {
      await prisma.message.update({
        where: { id: entry.id as string },
        data: { replyToId: targetId },
      });
    }
  }
}

/**
 * Chunks and embeds messages.
 *
 * Chat lines are usually far too short to retrieve on their own ("yes, agreed"
 * carries no searchable meaning), so each chunk is a *window* of consecutive
 * messages in the same channel. The chunk is attached to its first message,
 * which is also the message the citation points at, and the window's author and
 * date range are kept in metadata.
 */
export async function processMessages(
  deps: IngestDeps,
  messageIds: string[],
): Promise<PipelineResult> {
  const { prisma, embeddings } = deps;
  const logger = deps.logger ?? noopLogger;
  if (messageIds.length === 0) return { ok: true, chunks: 0, embedded: 0 };

  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    orderBy: [{ channel: 'asc' }, { messageDate: 'asc' }],
  });
  if (messages.length === 0) return { ok: true, chunks: 0, embedded: 0 };

  const targetTokens = deps.chunking?.targetTokens ?? 350;
  const byChannel = new Map<string, typeof messages>();
  for (const message of messages) {
    const bucket = byChannel.get(message.channel) ?? [];
    bucket.push(message);
    byChannel.set(message.channel, bucket);
  }

  type ChunkRow = {
    messageId: string;
    content: string;
    chunkIndex: number;
    tokenCount: number;
    metadata: Record<string, unknown>;
  };
  const rows: ChunkRow[] = [];

  for (const [channel, bucket] of byChannel) {
    let window: typeof messages = [];
    let tokens = 0;

    const flush = () => {
      if (window.length === 0) return;
      const anchor = window[0] as (typeof messages)[number];
      const last = window[window.length - 1] as (typeof messages)[number];
      const content = window
        .map(
          (message) =>
            `${message.authorName} (${message.messageDate.toISOString().slice(0, 10)}): ${message.content}`,
        )
        .join('\n');
      rows.push({
        messageId: anchor.id,
        content,
        chunkIndex: 0,
        tokenCount: estimateTokens(content),
        metadata: {
          source: 'message',
          channel,
          messageDate: anchor.messageDate.toISOString(),
          windowEnd: last.messageDate.toISOString(),
          messageCount: window.length,
          authors: [...new Set(window.map((message) => message.authorName))].slice(0, 10),
          isAnnouncement: window.some((message) => message.isAnnouncement),
        },
      });
      window = [];
      tokens = 0;
    };

    for (const message of bucket) {
      const messageTokens = estimateTokens(message.content);
      const gapHours =
        window.length > 0
          ? (message.messageDate.getTime() -
              (window[window.length - 1] as (typeof messages)[number]).messageDate.getTime()) /
            3_600_000
          : 0;
      // A long silence ends a conversation; do not weld unrelated threads
      // together just because they share a channel.
      if (window.length > 0 && (tokens + messageTokens > targetTokens || gapHours > 6)) {
        flush();
      }
      // Announcements are indexed on their own so a citation points precisely
      // at the announcement rather than at surrounding chatter.
      if (message.isAnnouncement) {
        flush();
        window = [message];
        tokens = messageTokens;
        flush();
        continue;
      }
      window.push(message);
      tokens += messageTokens;
    }
    flush();
  }

  const anchorIds = [...new Set(rows.map((row) => row.messageId))];
  await prisma.messageChunk.deleteMany({ where: { messageId: { in: anchorIds } } });

  // Several windows can share an anchor when announcements split a run.
  const perAnchor = new Map<string, number>();
  const data = rows.map((row) => {
    const index = perAnchor.get(row.messageId) ?? 0;
    perAnchor.set(row.messageId, index + 1);
    return { ...row, chunkIndex: index, metadata: { ...row.metadata, chunkIndex: index } };
  });

  await prisma.messageChunk.createMany({ data });

  const stored = await prisma.messageChunk.findMany({
    where: { messageId: { in: anchorIds } },
    select: { id: true, content: true },
  });
  const vectors = await embeddings.embedTexts(stored.map((chunk) => chunk.content));
  const embedded = await setMessageChunkEmbeddings(
    prisma,
    stored.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index] as number[] })),
  );

  await upsertMessageSources(prisma, messages);

  logger.info('messages processed', { messages: messages.length, chunks: data.length, embedded });
  return { ok: true, chunks: data.length, embedded };
}

/** One Source row per message, typed ANNOUNCEMENT when the message is one. */
async function upsertMessageSources(
  prisma: PrismaClient,
  messages: Array<{
    id: string;
    channel: string;
    authorName: string;
    content: string;
    messageDate: Date;
    isAnnouncement: boolean;
  }>,
): Promise<void> {
  for (const message of messages) {
    const type = message.isAnnouncement ? 'ANNOUNCEMENT' : 'MESSAGE';
    const title = message.isAnnouncement
      ? `Announcement in ${message.channel}`
      : `${message.channel} · ${message.authorName}`;
    await prisma.source.upsert({
      where: { type_referenceId: { type, referenceId: message.id } },
      create: {
        type,
        title,
        referenceId: message.id,
        messageId: message.id,
        authorName: message.authorName,
        occurredAt: message.messageDate,
        metadata: { channel: message.channel, messageDate: message.messageDate.toISOString() },
      },
      update: {
        title,
        authorName: message.authorName,
        occurredAt: message.messageDate,
        metadata: { channel: message.channel, messageDate: message.messageDate.toISOString() },
      },
    });
  }
}
