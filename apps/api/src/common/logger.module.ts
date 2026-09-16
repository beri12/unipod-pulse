import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@unipods/config';
import { StructuredLogger } from './logger';

/** Global so every module can inject the logger without importing anything. */
@Global()
@Module({
  providers: [
    {
      provide: StructuredLogger,
      useFactory: () => {
        const env = loadEnv();
        return new StructuredLogger(env.LOG_LEVEL, env.NODE_ENV === 'production');
      },
    },
  ],
  exports: [StructuredLogger],
})
export class LoggerModule {}
