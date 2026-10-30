import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { NextFunction, Request, Response } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.use(cookieParser());
  app.use((request: Request, _response: Response, next: NextFunction) => {
    process.stdout.write(`${request.method} ${request.originalUrl}\n`);
    next();
  });
  app.useStaticAssets(join(__dirname, '..', '..', 'client'), {
    index: false,
    setHeaders: (response, path) => {
      if (path.includes(`${join('assets')}`)) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  });
  app.enableShutdownHooks();
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  await app.listen(port, '0.0.0.0');
  process.stdout.write(`kinora listening on 0.0.0.0:${port}\n`);
}

void bootstrap();
