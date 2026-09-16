import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Env } from '@unipods/config';
import { PrismaClient, prismaClientOptions } from '@unipods/database';
import { StructuredLogger } from '../common/logger';
import { ENV } from '../config/config.module';

/**
 * The Prisma client as an injectable Nest provider, so every module shares one
 * connection pool and the pool is closed on shutdown.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(ENV) env: Env,
    private readonly logger: StructuredLogger,
  ) {
    super(prismaClientOptions(env.DATABASE_URL));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established', 'Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Round-trips a trivial query; used by the health endpoints. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
