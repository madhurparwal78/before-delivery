import type { Route } from '../router.js';
import { bookingRoutes } from './bookings.js';
import { documentRoutes } from './documents.js';
import { holdRoutes } from './holds.js';
import { kitchenRoutes } from './kitchen.js';
import { ledgerRoutes } from './ledger.js';
import { packetRoutes } from './packets.js';
import { sessionRoutes } from './session.js';
import { usageRoutes } from './usage.js';

export const apiRoutes: Route[] = [
  ...sessionRoutes,
  ...kitchenRoutes,
  ...holdRoutes,
  ...bookingRoutes,
  ...ledgerRoutes,
  ...documentRoutes,
  ...usageRoutes,
  ...packetRoutes,
];
