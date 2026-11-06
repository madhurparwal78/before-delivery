import type { RouteSpec } from './http.js';
import { accessRoutes } from './api/access.js';
import { boardRoutes } from './api/board.js';
import { callRoutes } from './api/calls.js';
import { clientRoutes } from './api/clients.js';
import { cueRoutes } from './api/cues.js';
import { cutRoutes } from './api/cuts.js';
import { enquiryRoutes } from './api/enquiries.js';
import { jobRoutes } from './api/jobs.js';
import { letterRoutes } from './api/letters.js';
import { lineRoutes } from './api/lines.js';
import { noteRoutes } from './api/notes.js';
import { packageRoutes } from './api/packages.js';
import { pageRoutes } from './api/pages.js';
import { producerPageRoutes } from './api/producerPages.js';
import { renderRoutes } from './api/renders.js';

/** Only the published endpoints exist. */
export const apiRoutes: RouteSpec[] = [
  ...accessRoutes,
  ...clientRoutes,
  ...jobRoutes,
  ...boardRoutes,
  ...lineRoutes,
  ...cueRoutes,
  ...cutRoutes,
  ...renderRoutes,
  ...pageRoutes,
  ...noteRoutes,
  ...producerPageRoutes,
  ...callRoutes,
  ...packageRoutes,
  ...letterRoutes,
  ...enquiryRoutes,
];
