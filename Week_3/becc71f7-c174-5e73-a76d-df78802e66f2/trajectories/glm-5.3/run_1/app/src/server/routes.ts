// Route table assembly (DP-54).

import type { Route } from './http.js';
import { sendJson } from './http.js';
import { sessionAndMemberRoutes } from './routes/members.js';
import { railRoutes } from './routes/rail.js';
import { pieceRoutes } from './routes/pieces.js';
import { ladderRoutes } from './routes/ladders.js';
import { holdRoutes } from './routes/holds.js';
import { saleRoutes } from './routes/sales.js';
import { payoutRoutes } from './routes/payouts.js';
import { consignorRoutes } from './routes/consignors.js';
import { portalRoutes } from './routes/portal.js';
import { appointmentRoutes } from './routes/appointments.js';
import { importRoutes } from './routes/imports.js';

export const routes: Route[] = [
  {
    method: 'GET', pattern: '/api/health', bodyLimit: 0, auth: 'public',
    handle: (ctx) => { sendJson(ctx.res, 200, { status: 'ok' }); },
  },
  ...sessionAndMemberRoutes,
  ...railRoutes,
  ...pieceRoutes,
  ...ladderRoutes,
  ...holdRoutes,
  ...saleRoutes,
  ...payoutRoutes,
  ...consignorRoutes,
  ...portalRoutes,
  ...appointmentRoutes,
  ...importRoutes,
];
