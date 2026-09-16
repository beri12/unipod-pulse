import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@unipods/config';
import type { SystemStatus } from '@unipods/types';
import { AiInfoService } from '../ai/ai.module';
import { ENV } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';

const startedAt = Date.now();

type ServiceStatus = SystemStatus['services'][number];

@Injectable()
export class HealthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly ai: AiInfoService,
  ) {}

  async database(): Promise<ServiceStatus> {
    return timed('database', () => this.prisma.ping());
  }

  async redis(): Promise<ServiceStatus> {
    return timed('redis', () => this.queues.ping());
  }

  async storageStatus(): Promise<ServiceStatus> {
    const started = Date.now();
    const result = await this.storage.healthCheck();
    return {
      name: `storage (${this.storage.driver})`,
      status: result.ok ? 'ok' : 'error',
      latencyMs: Date.now() - started,
      ...(result.detail ? { detail: result.detail } : {}),
    };
  }

  /** Full picture used by `/api/health` and the admin status page. */
  async status(): Promise<SystemStatus> {
    const services = await Promise.all([this.database(), this.redis(), this.storageStatus()]);
    const failing = services.filter((service) => service.status === 'error');
    return {
      status: failing.length === 0 ? 'ok' : failing.length === services.length ? 'error' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
      demoMode: this.env.DEMO_MODE,
      services,
      queues: await this.queues.counts(),
      ai: this.ai.describe(),
    };
  }
}

async function timed(name: string, probe: () => Promise<unknown>): Promise<ServiceStatus> {
  const started = Date.now();
  try {
    await probe();
    return { name, status: 'ok', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      name,
      status: 'error',
      latencyMs: Date.now() - started,
      detail: (error as Error).message,
    };
  }
}
