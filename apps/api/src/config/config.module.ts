import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from '@unipods/config';

export const ENV = Symbol('UNIPODS_ENV');

/**
 * Environment is parsed once, at module construction. An invalid configuration
 * therefore fails the process at boot rather than on the first request.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class AppConfigModule {}
