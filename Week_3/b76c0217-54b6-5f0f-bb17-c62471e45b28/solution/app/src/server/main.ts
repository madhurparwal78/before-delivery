import { dirname, join } from 'node:path';
import { config } from './config';
import { waitForDatabase } from './db';
import { listen } from './http';
import { prepareStorage } from './storage';
import { migrate } from './schema';
import { seedDemoIfEmpty } from './domain/demo';
import { retryHeldInvites } from './domain/invites';
import { gradingRoutes } from './routes/grading';
import { liveRoutes } from './routes/live';
import { pageRoutes } from './routes/pages';
import { previewRoutes } from './routes/previews';
import { publicRoutes } from './routes/public';
import { publishingRoutes } from './routes/publishing';
import { referenceRoutes } from './routes/reference';
import { sessionRoutes } from './routes/session';
import { shellRoutes } from './routes/shell';
import { siteRoutes } from './routes/sites';
import { teamRoutes } from './routes/team';

async function main(): Promise<void> {
  // Routes are matched in the order they are registered: the specific ones come before the wildcard page routes.
  sessionRoutes();
  gradingRoutes();
  teamRoutes();
  siteRoutes();
  pageRoutes();
  publishingRoutes();
  referenceRoutes();
  liveRoutes();
  previewRoutes();
  publicRoutes();
  shellRoutes();

  await waitForDatabase();
  await migrate();
  await prepareStorage().catch(() => undefined);
  await seedDemoIfEmpty();
  listen(config.port, join(dirname(process.argv[1] ?? '.'), 'public'));
  setInterval(() => void retryHeldInvites().catch((error: unknown) => console.error(error)), config.mailRetryMs);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
