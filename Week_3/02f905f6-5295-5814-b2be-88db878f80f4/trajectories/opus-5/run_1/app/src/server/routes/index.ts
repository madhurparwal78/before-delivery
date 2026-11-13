import type { Route } from '../http/router';
import { authRoutes } from './auth';
import { boardRoutes } from './board';
import { intakeRoutes } from './intakes';
import { photoRoutes } from './photos';
import { pieceRoutes } from './pieces';
import { rateRoutes } from './rates';
import { studioRoutes } from './studio';

export const allRoutes: Route[] = [
  ...authRoutes,
  ...rateRoutes,
  ...photoRoutes,
  ...intakeRoutes,
  ...pieceRoutes,
  ...boardRoutes,
  ...studioRoutes,
];
