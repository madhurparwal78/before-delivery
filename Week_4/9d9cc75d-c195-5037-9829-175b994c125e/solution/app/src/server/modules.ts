import { mountAlerts } from './alerts/index.ts';
import { mountAuth } from './auth/routes.ts';
import { mountDashboards } from './dashboards/index.ts';
import { mountEvents } from './events/routes.ts';
import { mountExports } from './exports/index.ts';
import { mountExtracts } from './extracts/routes.ts';
import { mountGrading } from './grading/routes.ts';
import type { Module } from './http/app.ts';
import { mountPlatform } from './http/platform.ts';
import { mountProjects } from './projects/routes.ts';
import { mountSources } from './sources/routes.ts';
import { mountWorkbooks } from './workbooks/index.ts';

/** Every module of the server, in mount order. Each registers its routes, schema statements and seed steps on the app. */
export const modules: readonly Module[] = [
  mountPlatform,
  mountAuth,
  mountProjects,
  mountSources,
  mountExtracts,
  mountEvents,
  mountWorkbooks,
  mountDashboards,
  mountAlerts,
  mountExports,
  mountGrading,
];
