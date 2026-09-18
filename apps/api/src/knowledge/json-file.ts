import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Logger } from '@nestjs/common';

/**
 * A JSON array on disk, loaded once and rewritten on change.
 *
 * Writes go through a queue and land via rename, so two concurrent updates
 * cannot interleave and a crash mid-write cannot leave a half-written file.
 */
export class JsonFile<T> {
  private readonly logger = new Logger(JsonFile.name);
  private items: T[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.items = Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Never overwrite a file we failed to understand — it may be
        // recoverable by hand.
        this.logger.error(
          `Could not read ${this.path} (${(error as Error).message}) — starting empty, the file is left untouched`,
        );
      }
      this.items = [];
    }
  }

  all(): T[] {
    return this.items;
  }

  set(items: T[]): Promise<void> {
    this.items = items;
    return this.save();
  }

  save(): Promise<void> {
    const snapshot = JSON.stringify(this.items, null, 2);

    this.queue = this.queue.then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        await writeFile(temporary, snapshot, 'utf8');
        await rename(temporary, this.path);
      } catch (error) {
        this.logger.error(`Could not write ${this.path}: ${(error as Error).message}`);
      }
    });

    return this.queue;
  }
}
