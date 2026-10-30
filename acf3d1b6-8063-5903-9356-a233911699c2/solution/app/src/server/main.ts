import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { AuthService } from './auth.js';
import { config } from './config.js';
import { CreditsService } from './credits.js';
import { Database } from './database.js';
import { ErrorFilter } from './errors.js';
import { pageServer, type PageRenderer } from './pages.js';
import { seed } from './seed.js';
import { TeamService } from './team.js';

const dist = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/** One line per request on standard output: method, path, status and time taken. */
function logRequests(req: Request, res: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    process.stdout.write(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms\n`);
  });
  next();
}

function baseHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
}

/** Malformed or oversized JSON bodies are the caller's mistake. */
function bodyErrors(error: { status?: number }, _req: Request, res: Response, next: NextFunction) {
  if (error?.status && error.status < 500) return res.status(error.status).json({ error: 'bad_request' });
  next(error);
}

async function connect(db: Database): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const db = app.get(Database);
  await connect(db);
  await db.setUp((client) => seed(client, app.get(CreditsService)));

  const renderer = (await import(dist('ssr/entry-server.js'))) as PageRenderer;
  const auth = app.get(AuthService);
  app.use(logRequests);
  app.use(baseHeaders);
  app.use(cookieParser());
  app.useStaticAssets(dist('client/assets'), { prefix: '/assets/', index: false, immutable: true, maxAge: '365d' });
  app.use(pageServer(dist('client/index.html'), renderer, auth, app.get(TeamService)));
  app.use(auth.authenticate);
  app.useBodyParser('json', { limit: '64kb' });
  app.use(bodyErrors);

  await app.listen(config.port, '0.0.0.0');
  new Logger('Kinora').log(`Listening on 0.0.0.0:${config.port}`);
}

void bootstrap();
