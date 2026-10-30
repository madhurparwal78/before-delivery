import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, Catch, HttpException, ExceptionFilter } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ApiController } from './api';
import { PagesController } from './pages-controller';
import { migrate, seed } from './db.mjs';
import { startScheduler } from './scheduler.mjs';

/** Map every thrown error to one client shape; never a silent success. */
@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(err, host) {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let payload = { error: 'server_error' };
    if (err instanceof HttpException) {
      status = err.getStatus();
      const body = err.getResponse();
      payload = typeof body === 'string' ? { error: body } : body;
    } else if (err && typeof err.status === 'number') {
      status = err.status;
      payload = err.payload || { error: 'error' };
    } else {
      console.log(`[error] ${err && err.stack ? err.stack.split('\n')[0] : err}`);
    }
    res.status(status).json(payload);
  }
}

@Module({ controllers: [ApiController, PagesController] })
class RootModule {}

async function bootstrap() {
  const port = parseInt(process.env.APP_PUBLIC_PORT || '4173', 10);
  const app = await NestFactory.create(RootModule, { logger: false, bodyParser: false });
  const express = app.getHttpAdapter().getInstance();

  express.use(cookieParser());
  express.use((req, res, next) => {
    console.log(`${req.method} ${req.originalUrl || req.url}`);
    next();
  });
  app.useGlobalFilters(new ApiErrorFilter());

  await migrate();
  await seed();
  startScheduler();
  await app.listen(port, '0.0.0.0');
  console.log(`kinora listening on 0.0.0.0:${port}`);
}

bootstrap().catch((e) => {
  console.log(`[fatal] ${e.stack || e.message || e}`);
  process.exit(1);
});
