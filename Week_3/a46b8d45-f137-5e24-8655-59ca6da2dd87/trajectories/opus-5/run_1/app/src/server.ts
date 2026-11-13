/**
 * The desk's entry point. It starts and serves whether or not MinIO, the carrier, Kill
 * Bill, Mailpit or Postgres can be reached, and it never exits because a service is down.
 */

import { createServer } from 'node:http';

import { apiRoutes } from './api/routes';
import { config } from './config';
import { pageRoutes } from './ui/page-routes';
import { Router } from './http/router';
import { staticRoutes } from './http/static';
import { watchForRecords } from './db/pool';
import { watchNoticeQueue } from './services/notices';

const router = new Router();
router.addAll(staticRoutes);
router.addAll(apiRoutes);
router.addAll(pageRoutes);

const server = createServer((request, response) => {
  void router.dispatch(request, response);
});

// A failed request must never take the desk down.
process.on('uncaughtException', () => undefined);
process.on('unhandledRejection', () => undefined);

server.listen(config.port, '0.0.0.0', () => {
  // The schema lands as soon as Postgres answers, and the queue drains as soon as Mailpit does.
  watchForRecords();
  watchNoticeQueue();
});
