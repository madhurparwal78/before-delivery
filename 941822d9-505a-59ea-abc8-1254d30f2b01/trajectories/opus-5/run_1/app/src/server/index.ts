import { config } from './config.js';
import { applySchemaAndSeed } from './db/seed.js';
import { waitForDatabase } from './db/pool.js';
import { createHttpServer } from './http/server.js';
import type { Route } from './http/router.js';
import type { Reply } from './http/context.js';
import { certificateRoutes } from './routes/certificates.js';
import { checkoutRoutes } from './routes/checkout.js';
import { cohortRoutes } from './routes/cohorts.js';
import { courseRoutes } from './routes/courses.js';
import { enrolmentRoutes } from './routes/enrolments.js';
import { refundRoutes } from './routes/refunds.js';
import { sessionRoutes } from './routes/session.js';
import { sponsorRoutes } from './routes/sponsor.js';
import { verifyRoutes } from './routes/verify.js';
import { startMailerLoop } from './services/mailer.js';
import { startSealRetryLoop } from './services/sealing.js';
import { ensureBucket } from './services/storage.js';

const healthRoute: Route = {
  method: 'GET',
  path: '/api/health',
  auth: 'public',
  handler: async (): Promise<Reply> => ({ status: 200, json: { status: 'ok' } }),
};

const routes: readonly Route[] = [
  healthRoute,
  ...sessionRoutes,
  ...courseRoutes,
  ...cohortRoutes,
  ...checkoutRoutes,
  ...enrolmentRoutes,
  ...certificateRoutes,
  ...verifyRoutes,
  ...refundRoutes,
  ...sponsorRoutes,
];

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchemaAndSeed();
  await ensureBucket();

  startMailerLoop();
  startSealRetryLoop();

  const server = createHttpServer(routes);
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Credwell listening on 0.0.0.0:${config.port}\n`);
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`Credwell failed to start: ${String(error)}\n`);
  process.exit(1);
});
