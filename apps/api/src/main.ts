import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { APP_NAME, APP_TAGLINE, loadEnv } from '@unipods/config';
import type { ValidationError } from 'class-validator';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppException, ERROR_CODES, type AppErrorDetail } from './common/errors';
import { StructuredLogger } from './common/logger';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new StructuredLogger(env.LOG_LEVEL, env.NODE_ENV === 'production');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bodyParser: true,
    // Behind a reverse proxy the client IP comes from X-Forwarded-For; the
    // rate limiter needs it to be accurate.
    rawBody: false,
  });

  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  // Conservative security headers, set without pulling in helmet.
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors: ValidationError[]) =>
        AppException.badRequest(
          'Some of the submitted values are not valid.',
          ERROR_CODES.VALIDATION_FAILED,
          flattenValidationErrors(errors),
        ),
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(logger));

  if (env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle(`${APP_NAME} API`)
      .setDescription(
        `${APP_TAGLINE}\n\nEvery answer this API returns is grounded in retrieved community sources and carries citations. ` +
          'When retrieval finds no supporting evidence the API says so rather than guessing.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(
    `${APP_NAME} API listening on port ${env.PORT} (ai=${env.AI_PROVIDER}, storage=${env.STORAGE_DRIVER}, demo=${env.DEMO_MODE})`,
    'Bootstrap',
  );
}

/** Flattens nested class-validator errors into `field -> message` pairs. */
function flattenValidationErrors(errors: ValidationError[], parent = ''): AppErrorDetail[] {
  const details: AppErrorDetail[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    for (const message of Object.values(error.constraints ?? {})) {
      details.push({ field, message });
    }
    if (error.children?.length) {
      details.push(...flattenValidationErrors(error.children, field));
    }
  }
  return details;
}

bootstrap().catch((error: unknown) => {
  // Configuration problems surface here; print them plainly and stop.
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      msg: 'API failed to start',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exit(1);
});
