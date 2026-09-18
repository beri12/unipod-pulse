import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JsonFile } from './json-file.js';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from './knowledge.config.js';
import {
  GLOBAL_SCOPE,
  type ArchivedMessage,
  type KnowledgeEntry,
  type KnowledgeGap,
} from './knowledge.types.js';

/**
 * Everything the bot knows, on disk: knowledge entries, the gap backlog, and a
 * rolling archive of recent messages used for "what did I miss".
 */
@Injectable()
export class KnowledgeStoreService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeStoreService.name);
  private readonly entriesFile: JsonFile<KnowledgeEntry>;
  private readonly gapsFile: JsonFile<KnowledgeGap>;
  private readonly archiveFile: JsonFile<ArchivedMessage>;

  constructor(@Inject(KNOWLEDGE_CONFIG) private readonly config: KnowledgeConfig) {
    this.entriesFile = new JsonFile(join(config.dataDir, 'knowledge.json'));
    this.gapsFile = new JsonFile(join(config.dataDir, 'gaps.json'));
    this.archiveFile = new JsonFile(join(config.dataDir, 'archive.json'));
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.entriesFile.load(), this.gapsFile.load(), this.archiveFile.load()]);
    this.logger.log(
      `Knowledge: ${this.entries().length} entries, ${this.openGaps().length} open questions`,
    );
  }

  // ─── Knowledge entries ────────────────────────────────────────────────────

  entries(): KnowledgeEntry[] {
    return this.entriesFile.all();
  }

  /** Entries usable in a given chat: that chat's own, plus community-wide. */
  entriesFor(scope: string): KnowledgeEntry[] {
    return this.entries().filter(
      (entry) => entry.scope === scope || entry.scope === GLOBAL_SCOPE,
    );
  }

  findEntry(id: string): KnowledgeEntry | undefined {
    return this.entries().find((entry) => entry.id === id);
  }

  async addEntry(
    entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'useCount'>,
  ): Promise<KnowledgeEntry> {
    const created: KnowledgeEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      useCount: 0,
    };

    const items = this.entries();
    // Re-answering the same question replaces the old answer instead of
    // leaving two entries for the matcher to choose between.
    if (created.type === 'qa') {
      const duplicate = items.findIndex(
        (existing) =>
          existing.type === 'qa' &&
          existing.scope === created.scope &&
          existing.title.trim().toLowerCase() === created.title.trim().toLowerCase(),
      );
      if (duplicate >= 0) items.splice(duplicate, 1);
    }

    items.push(created);
    await this.entriesFile.save();
    return created;
  }

  async addEntries(
    entries: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'useCount'>[],
  ): Promise<KnowledgeEntry[]> {
    const created: KnowledgeEntry[] = [];
    for (const entry of entries) created.push(await this.addEntry(entry));
    return created;
  }

  async removeEntry(id: string): Promise<boolean> {
    const items = this.entries();
    const index = items.findIndex((entry) => entry.id === id);
    if (index < 0) return false;

    items.splice(index, 1);
    await this.entriesFile.save();
    return true;
  }

  /** Drops every entry that came from one import, by source label. */
  async removeBySourceLabel(label: string): Promise<number> {
    const items = this.entries();
    const kept = items.filter((entry) => entry.source?.label !== label);
    const removed = items.length - kept.length;
    if (removed > 0) await this.entriesFile.set(kept);
    return removed;
  }

  async markUsed(ids: string[]): Promise<void> {
    const now = new Date().toISOString();
    let changed = false;

    for (const id of ids) {
      const entry = this.findEntry(id);
      if (!entry) continue;
      entry.useCount += 1;
      entry.lastUsedAt = now;
      changed = true;
    }
    if (changed) await this.entriesFile.save();
  }

  // ─── Gaps: questions nobody has answered ──────────────────────────────────

  gaps(): KnowledgeGap[] {
    return this.gapsFile.all();
  }

  openGaps(scope?: string): KnowledgeGap[] {
    return this.gaps().filter(
      (gap) => !gap.resolved && (scope === undefined || gap.scope === scope),
    );
  }

  /** Records a question, or counts another person asking the same one. */
  async recordGap(
    gap: Omit<KnowledgeGap, 'id' | 'createdAt' | 'timesAsked' | 'lastAskedAt' | 'resolved'>,
  ): Promise<KnowledgeGap> {
    const now = new Date().toISOString();
    const existing = this.gaps().find(
      (candidate) =>
        !candidate.resolved &&
        candidate.scope === gap.scope &&
        candidate.question.trim().toLowerCase() === gap.question.trim().toLowerCase(),
    );

    if (existing) {
      existing.timesAsked += 1;
      existing.lastAskedAt = now;
      await this.gapsFile.save();
      return existing;
    }

    const created: KnowledgeGap = {
      ...gap,
      id: randomUUID(),
      createdAt: now,
      timesAsked: 1,
      lastAskedAt: now,
      resolved: false,
    };
    this.gaps().push(created);
    await this.gapsFile.save();
    return created;
  }

  async resolveGap(id: string, answer: string, resolvedBy?: string): Promise<KnowledgeGap | null> {
    const gap = this.gaps().find((candidate) => candidate.id === id);
    if (!gap) return null;

    gap.resolved = true;
    gap.resolvedAnswer = answer;
    gap.resolvedBy = resolvedBy;
    await this.gapsFile.save();
    return gap;
  }

  // ─── Message archive ──────────────────────────────────────────────────────

  async archive(message: ArchivedMessage): Promise<void> {
    const items = this.archiveFile.all();
    items.push(message);

    // Rolling window per chat, so one busy group cannot push every other
    // group's history out of the file.
    const limit = this.config.archiveLimit;
    const perChat = new Map<string, number>();
    const kept: ArchivedMessage[] = [];

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const candidate = items[index]!;
      const count = perChat.get(candidate.chatId) ?? 0;
      if (count >= limit) continue;
      perChat.set(candidate.chatId, count + 1);
      kept.unshift(candidate);
    }

    await this.archiveFile.set(kept);
  }

  /** Messages in a chat since a moment, oldest first. */
  archivedSince(chatId: string, since: Date): ArchivedMessage[] {
    return this.archiveFile
      .all()
      .filter((message) => message.chatId === chatId && new Date(message.at) >= since);
  }
}
