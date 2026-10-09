import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { AppModule } from './app.module';
import { HttpErrorFilter, installProcessHandlers, requestLog } from './common/errors';
import { config } from './config';

async function bootstrap() {
  installProcessHandlers();
  const app = await NestFactory.create(AppModule, {
    // Production keeps the log readable (no per-request debug lines); set LOG_LEVEL=debug to see them.
    logger: (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'log' : 'debug')) === 'debug' ? ['error', 'warn', 'log', 'debug'] : ['error', 'warn', 'log'],
  });
  app.enableCors({ origin: [config.webOrigin, /^http:\/\/localhost:\d+$/], exposedHeaders: ['Content-Disposition'], credentials: true });
  app.enableShutdownHooks();
  app.use(requestLog);
  app.useGlobalFilters(new HttpErrorFilter());
  // The inbound mail webhook takes the raw message (any content type), not JSON.
  app.use('/mail/inbound', raw({ type: () => true, limit: '30mb' }));
  await app.listen(config.port);
  Logger.log(`Master Office API on http://localhost:${config.port}`, 'Bootstrap');
}
bootstrap().catch((e: Error) => {
  Logger.error(`startup failed: ${e.stack ?? e.message}`, 'Bootstrap');
  process.exit(1);
});
