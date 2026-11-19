/* Route registry: one table of methods, patterns and handlers. */

export type Ctx = import('./context.js').Ctx;
export type Services = {
  cfg: import('../config.js').AppConfig;
  db: import('./db.js').Db;
  valkey: import('./valkey.js').Valkey;
  mailer: import('./mail.js').Mailer;
  storage: import('@aws-sdk/client-s3').S3Client;
  state: { pgUp: boolean; storageUp: boolean; valkeyUp: boolean };
  routes: RouteTable;
};

export type RouteResult = { status: number; body: unknown } | undefined;

export type RouteHandler = (ctx: Ctx) => Promise<RouteResult>;

export type Route = {
  method: string;
  pattern: RegExp;
  paramNames: Record<string, number>;
  run: RouteHandler;
  wantsBody: 'json' | 'multipart' | 'none' | 'stream';
};

export type RouteTable = { list: Route[] };

export function route(method: string, path: string, run: RouteHandler, wantsBody: 'json' | 'multipart' | 'none' | 'stream' = 'json'): Route {
  const paramNames: Record<string, number> = {};
  const pattern = pathToRegex(path, paramNames);
  return { method, pattern, paramNames, run, wantsBody };
}

function pathToRegex(path: string, paramNames: Record<string, number>): RegExp {
  const groups: string[] = [];
  let re = '^';
  for (const part of path.split('/')) {
    if (part === '') continue;
    re += '/';
    const m = /^:(\w+)$/.exec(part);
    if (m !== null) {
      paramNames[m[1] as string] = groups.length;
      groups.push('([^/]+)');
      re += '\u0000'; // placeholder replaced with the group below
    } else {
      re += escapeRe(part);
    }
  }
  re += '/?$';
  let idx = 0;
  const final = re.replace(/\u0000/g, () => groups[idx++] ?? '([^/]+)');
  return new RegExp(final);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { registerAuthRoutes } from './routes/auth.js';
import { registerCommunityRoutes } from './routes/communities.js';
import { registerPostRoutes } from './routes/posts.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerModerationRoutes } from './routes/moderation.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerMiscRoutes } from './routes/misc.js';
import { registerImageRoutes } from './routes/images.js';
import { registerGradingRoutes } from './routes/grading.js';

export function registerRoutes(services: Services): RouteTable {
  const list: Route[] = [];
  const table: RouteTable = { list };
  const add = (r: Route): void => { list.push(r); };
  registerAuthRoutes(services, add);
  registerCommunityRoutes(services, add);
  registerPostRoutes(services, add);
  registerCommentRoutes(services, add);
  registerModerationRoutes(services, add);
  registerReportRoutes(services, add);
  registerMiscRoutes(services, add);
  registerImageRoutes(services, add);
  registerGradingRoutes(services, add);
  return table;
}
