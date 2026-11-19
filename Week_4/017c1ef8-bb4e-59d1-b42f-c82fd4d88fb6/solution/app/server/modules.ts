import type { RouteModule } from './app.js';
import { seedDemoData } from './domain/demo-seed.js';
import { registerEditorPresence } from './domain/editor-presence.js';
import { registerJobTick } from './domain/jobs.js';
import { applicationRoutes } from './routes/applications.js';
import { companyRoutes } from './routes/companies.js';
import { feedRoutes } from './routes/feed.js';
import { gradingRoutes } from './routes/grading.js';
import { jobRoutes } from './routes/jobs.js';
import { messagingRoutes } from './routes/messaging.js';
import { networkRoutes } from './routes/network.js';
import { notificationRoutes } from './routes/notifications.js';
import { postRoutes } from './routes/posts.js';
import { registerPostTick } from './domain/posts.js';
import { profileRoutes } from './routes/profiles.js';
import { searchRoutes } from './routes/search.js';
import { skillRoutes } from './routes/skills.js';

/** Routes that need no session (beyond system and auth). */
export const publicRouteModules: RouteModule[] = [gradingRoutes];

/** Routes that run behind the session. */
export const memberRouteModules: RouteModule[] = [
  profileRoutes,
  networkRoutes,
  postRoutes,
  feedRoutes,
  notificationRoutes,
  searchRoutes,
  messagingRoutes,
  skillRoutes,
  companyRoutes,
  jobRoutes,
  applicationRoutes,
];

/** Work that must finish before the server listens (demo data, tick registrations). */
export async function prepare(): Promise<void> {
  await seedDemoData();
  registerPostTick();
  registerJobTick();
  registerEditorPresence();
}
