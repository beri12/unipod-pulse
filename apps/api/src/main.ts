import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

// Node reads .env natively; it is absent in most deployments, hence the guard.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — rely on real environment variables.
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    // Keeps the untouched request bytes so the WhatsApp webhook can verify
    // Meta's X-Hub-Signature-256 against exactly what was sent.
    rawBody: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
