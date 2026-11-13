import { Route } from '../http/kernel';
import { drawRoutes } from './draws';
import { memberRoutes } from './members';
import { messageRoutes } from './messages';
import { planRoutes } from './plans';
import { publicRoutes } from './public';
import { recordRoutes } from './records';
import { resultsRoutes } from './results';
import { staffRoutes } from './staff';
import { visitRoutes } from './visits';

export const apiRoutes: Route[] = [
  ...publicRoutes,
  ...staffRoutes,
  ...memberRoutes,
  ...drawRoutes,
  ...visitRoutes,
  ...resultsRoutes,
  ...planRoutes,
  ...messageRoutes,
  ...recordRoutes,
];
