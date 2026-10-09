import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { AppModule } from './app.module';
import { HttpErrorFilter, installProcessHandlers, requestLog } from './common/errors';
import { assertProductionConfig, config } from './config';
import { securityHeaders } from './common/http';
import { requestContext } from './common/request-context';

async function bootstrap() {
  installProcessHandlers();
  assertProductionConfig();
  const app = await NestFactory.create(AppModule, {
    // Production keeps the log readable (no per-request debug lines); set LOG_LEVEL=debug to see them.
    logger: (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'log' : 'debug')) === 'debug' ? ['error', 'warn', 'log', 'debug'] : ['error', 'warn', 'log'],
  });
  // Caddy (or any reverse proxy) sits in front: req.ip and req.secure come from X-Forwarded-*, so throttling counts
  // real clients and the session cookie learns it is on HTTPS.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // Any localhost port may call the API in development (the web dev server picks a port); production is the site only.
  app.enableCors({ origin: config.production ? [config.webOrigin] : [config.webOrigin, /^http:\/\/localhost:\d+$/], exposedHeaders: ['Content-Disposition'], credentials: true });
  app.enableShutdownHooks();
  app.use(requestContext);
  app.use(securityHeaders);
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
