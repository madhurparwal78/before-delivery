import { creditRoutes } from './credit.ts';
import { eventRoutes } from './events.ts';
import { inviteRoutes } from './invites.ts';
import { loadRoutes } from './loads.ts';
import { memberRoutes } from './members.ts';
import { pieceRoutes } from './pieces.ts';
import { reportRoutes } from './reports.ts';
import { sessionRoutes } from './session.ts';
import { studioRoutes } from './studio.ts';
import type { Route } from '../http/context.ts';

export const allRoutes: readonly Route[] = [
  ...sessionRoutes,
  ...eventRoutes,
  ...inviteRoutes,
  ...studioRoutes,
  ...pieceRoutes,
  ...loadRoutes,
  ...creditRoutes,
  ...memberRoutes,
  ...reportRoutes,
];
