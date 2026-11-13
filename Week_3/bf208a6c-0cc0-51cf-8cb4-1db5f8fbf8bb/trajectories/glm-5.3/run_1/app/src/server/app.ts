import type { Db } from './db.js';
import type { Config } from './config.js';
import type { Services } from './services.js';
import type { EventHub } from './events.js';
import type { RequestContext } from './http.js';
import type { PassUnlock } from './cookies.js';

export interface App {
  db: Db;
  config: Config;
  services: Services;
  events: EventHub;
  passUnlocks(ctx: RequestContext): PassUnlock[];
  addPassUnlock(ctx: RequestContext, boardId: string, generation: number): void;
  setSessionCookie(ctx: RequestContext, value: string | null): void;
  setPassCookie(ctx: RequestContext, value: string): void;
}
