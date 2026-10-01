import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: [config.webOrigin, /^http:\/\/localhost:\d+$/], exposedHeaders: ['Content-Disposition'], credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`Master Office API on http://localhost:${config.port}`, 'Bootstrap');
}
bootstrap();
