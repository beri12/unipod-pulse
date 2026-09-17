import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from '@unipods/config';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AdminModule } from './admin/admin.module';
import { BotsModule } from './bots/bots.module';
import { CatchUpModule } from './catch-up/catch-up.module';
import { ChatModule } from './chat/chat.module';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { LoggerModule } from './common/logger.module';
import { AppConfigModule } from './config/config.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { MeetingsModule } from './meetings/meetings.module';
import { MessagesModule } from './messages/messages.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionsModule } from './questions/questions.module';
import { QueueModule } from './queue/queue.module';
import { RagModule } from './rag/rag.module';
import { SearchModule } from './search/search.module';
import { SourcesModule } from './sources/sources.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          throttlers: [{ ttl: env.RATE_LIMIT_TTL * 1000, limit: env.RATE_LIMIT_LIMIT }],
        };
      },
    }),
    PrismaModule,
    QueueModule,
    StorageModule,
    AiModule,
    HealthModule,
    AuthModule,
    UsersModule,
    SourcesModule,
    DocumentsModule,
    MeetingsModule,
    MessagesModule,
    RagModule,
    ChatModule,
    SearchModule,
    CatchUpModule,
    QuestionsModule,
    AdminModule,
    BotsModule,
  ],
  providers: [
    // Order matters: the request context wraps everything so logs and guards
    // share one request id.
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
