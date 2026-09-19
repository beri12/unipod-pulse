// Must come first: it populates process.env before any module reads it.
import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument, observeEnabled } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Instrumenting without credentials makes every request fail telemetry.
    ...(observeEnabled ? { instrument: ObserveInstrument } : {}),
    // Keeps the untouched request bytes so the WhatsApp webhook can verify
    // Meta's X-Hub-Signature-256 against exactly what was sent.
    rawBody: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
