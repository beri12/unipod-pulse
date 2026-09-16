import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type Env, type QueueName } from '@unipods/config';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { AppException, ERROR_CODES } from '../common/errors';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Owns the Redis connection and one BullMQ `Queue` per queue name.
 *
 * Nothing expensive ever runs inside an HTTP request: controllers enqueue and
 * return immediately, and the worker app does the work.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    @Inject(ENV) env: Env,
    private readonly logger: StructuredLogger,
  ) {
    this.connection = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 500, 10_000),
    });
    this.connection.on('error', (error) => {
      this.logger.warn('Redis connection error', { reason: error.message }, 'Queue');
    });

    for (const name of Object.values(QUEUE_NAMES)) {
      this.queues.set(
        name,
        new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
      );
    }
  }

  private queue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }

  /** Enqueues a job. Throws a 503-mapped error if Redis is unreachable. */
  async enqueue<T extends object>(
    queueName: QueueName,
    jobName: string,
    payload: T,
    options: { jobId?: string; delayMs?: number } = {},
  ): Promise<string> {
    try {
      const job = await this.queue(queueName).add(jobName, payload, {
        ...(options.jobId ? { jobId: options.jobId } : {}),
        ...(options.delayMs ? { delay: options.delayMs } : {}),
      });
      this.logger.event('debug', 'job enqueued', {
        queue: queueName,
        job: jobName,
        jobId: job.id,
      });
      return job.id ?? '';
    } catch (error) {
      this.logger.error('Failed to enqueue job', error as Error, 'Queue');
      throw new AppException(
        ERROR_CODES.QUEUE_UNAVAILABLE,
        'Background processing is unavailable right now. Please try again shortly.',
        503,
      );
    }
  }

  async counts(): Promise<QueueCounts[]> {
    const results: QueueCounts[] = [];
    for (const [name, queue] of this.queues) {
      try {
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
        );
        results.push({
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        });
      } catch {
        results.push({ name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      }
    }
    return results;
  }

  async ping(): Promise<void> {
    const reply = await this.connection.ping();
    if (reply !== 'PONG') throw new Error(`Unexpected Redis reply: ${reply}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
    this.connection.disconnect();
  }
}
