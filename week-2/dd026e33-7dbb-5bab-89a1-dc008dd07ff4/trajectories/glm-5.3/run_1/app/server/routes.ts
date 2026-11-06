import type { Route } from './router.ts';
import { sessionRoutes } from './api/session.ts';
import { carRoutes } from './api/cars.ts';
import { careRoutes } from './api/care.ts';
import { jobRoutes } from './api/jobs.ts';
import { invoiceRoutes } from './api/invoices.ts';
import { releaseRoutes } from './api/releases.ts';
import { boardRoutes } from './api/board.ts';

export const routes: Route[] = [
  ...sessionRoutes,
  ...carRoutes,
  ...careRoutes,
  ...jobRoutes,
  ...invoiceRoutes,
  ...releaseRoutes,
  ...boardRoutes,
];
