import { builderRoutes } from './builder.js';
import { depositRoutes } from './deposits.js';
import { marketRoutes } from './markets.js';
import { orderRoutes } from './orders.js';
import { ownerRoutes } from './owner.js';
import { platformRoutes } from './platform.js';
import { sessionRoutes } from './session.js';
import { statementRoutes } from './statements.js';
import { streamRoutes } from './stream.js';
import type { Route } from '../http/router.js';

export const routes: readonly Route[] = [
  ...platformRoutes,
  ...sessionRoutes,
  ...marketRoutes,
  ...streamRoutes,
  ...orderRoutes,
  ...depositRoutes,
  ...statementRoutes,
  ...builderRoutes,
  ...ownerRoutes,
];
