import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { FAQ_CONFIG, type FaqConfig } from './faq.config.js';
import type { FaqEntry } from './faq.types.js';

/**
 * Learned answers, kept in a JSON file.
 *
 * A community FAQ is a few hundred short entries, so a file is enough and
 * needs no database to run. The whole set is held in memory and rewritten on
 * change; see README for moving this to Postgres when it outgrows that.
 */
@Injectable()
export class FaqStoreService implements OnModuleInit {
  private readonly logger = new Logger(FaqStoreService.name);
  private entries: FaqEntry[] = [];
  /** Serialises writes so two concurrent answers cannot clobber the file. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(@Inject(FAQ_CONFIG) private readonly config: FaqConfig) {}

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  all(): FaqEntry[] {
    return this.entries;
  }

  count(): number {
    return this.entries.length;
  }

  find(id: string): FaqEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  async add(
    entry: Omit<FaqEntry, 'id' | 'createdAt' | 'useCount'>,
  ): Promise<FaqEntry> {
    const created: FaqEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      useCount: 0,
    };

    // A repeated question replaces the old answer rather than piling up a
    // second copy that the matcher would have to choose between.
    const duplicate = this.entries.findIndex(
      (existing) =>
        existing.chatId === created.chatId &&
        existing.question.trim().toLowerCase() === created.question.trim().toLowerCase(),
    );
    if (duplicate >= 0) this.entries.splice(duplicate, 1);

    this.entries.push(created);
    await this.persist();
    return created;
  }

  async remove(id: string): Promise<boolean> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return false;

    this.entries.splice(index, 1);
    await this.persist();
    return true;
  }

  async markUsed(id: string): Promise<void> {
    const entry = this.find(id);
    if (!entry) return;

    entry.useCount += 1;
    entry.lastUsedAt = new Date().toISOString();
    await this.persist();
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.config.storePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.entries = Array.isArray(parsed) ? (parsed as FaqEntry[]) : [];
      this.logger.log(`Loaded ${this.entries.length} learned answers`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.log('No FAQ file yet — starting empty');
        this.entries = [];
        return;
      }
      // A corrupt file must not take the bot down, and must not be
      // overwritten silently either.
      this.logger.error(
        `Could not read ${this.config.storePath} (${(error as Error).message}) — starting empty, the file is left untouched`,
      );
      this.entries = [];
    }
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.entries, null, 2);

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await mkdir(dirname(this.config.storePath), { recursive: true });
        // Write then rename: a crash mid-write cannot leave a half file.
        const temporary = `${this.config.storePath}.tmp`;
        await writeFile(temporary, snapshot, 'utf8');
        await rename(temporary, this.config.storePath);
      } catch (error) {
        this.logger.error(`Could not save learned answers: ${(error as Error).message}`);
      }
    });

    return this.writeQueue;
  }
}
