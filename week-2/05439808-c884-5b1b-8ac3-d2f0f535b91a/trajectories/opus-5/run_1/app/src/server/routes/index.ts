import type { Route } from '../http/route.js';
import { armyRoutes } from './army.js';
import { authRoutes } from './auth.js';
import { clanRoutes } from './clan.js';
import { meRoutes } from './me.js';
import { opsRoutes } from './ops.js';
import { raidRoutes } from './raids.js';
import { villageRoutes } from './village.js';

export const routes: Route[] = [
  ...authRoutes,
  ...meRoutes,
  ...villageRoutes,
  ...armyRoutes,
  ...raidRoutes,
  ...clanRoutes,
  ...opsRoutes
];
