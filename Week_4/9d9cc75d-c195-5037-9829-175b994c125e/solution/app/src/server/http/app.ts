import type { IncomingMessage } from 'node:http';
import type { Role } from '../../shared/model.ts';
import type { Config } from '../config.ts';
import { Clock } from '../clock.ts';
import { Database } from '../db/database.ts';
import { EventHub } from '../events/hub.ts';
import type { SeedStep } from '../grading/seed.ts';
import { Storage } from '../storage/storage.ts';
import { RateLimiter } from './rate.ts';
import type { Reply } from './reply.ts';
import type { JsonObject } from './validate.ts';

export interface AuthUser {
  id: string;
  username: string;
}

/** What a request handler receives. `user` is never null on a route declared with `app.route`. */
export interface Context<U extends AuthUser | null = AuthUser> {
  readonly app: App;
  readonly req: IncomingMessage;
  readonly url: URL;
  /** Path parameters, already decoded. */
  readonly params: Record<string, string>;
  readonly user: U;
  /** The request body exactly as received (CSV routes: the bytes to store). Empty on `body: 'none'` routes. */
  readonly raw: Buffer;
  /** The parsed JSON body, or undefined when it is not valid JSON. Never throws. */
  peek(): unknown;
  /** The body as a JSON object; a malformed or non-object body is a 422. Call it after the 404/403/409 checks. */
  object(): JsonObject;
}

type BodyKind = 'json' | 'csv' | 'none';

export interface RateRule {
  limiter: RateLimiter;
  /** The limiter key, or null when there is nothing to limit (for example no signed-in user yet). */
  key: (ctx: Context<AuthUser | null>) => string | null;
}

interface RouteBase {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** `/api/sources/:id/tables/:table`; `:name` segments become `ctx.params.name`. */
  path: string;
  /** `json` and `csv` routes read the body and answer 413/415; `none` ignores it. */
  body?: BodyKind;
  rate?: RateRule;
  /** The 413 body for this route, given the number of bytes received. */
  tooLarge?: (size: number) => Record<string, unknown>;
  /** Answer even while PostgreSQL is still unreachable at boot. */
  beforeDatabase?: boolean;
}

export interface RouteDef extends RouteBase {
  handler: (ctx: Context<AuthUser>) => Promise<Reply> | Reply;
}

export interface PublicRouteDef extends RouteBase {
  handler: (ctx: Context<AuthUser | null>) => Promise<Reply> | Reply;
}

export type Route =
  | (RouteBase & { open: false; handler: RouteDef['handler'] })
  | (RouteBase & { open: true; handler: PublicRouteDef['handler'] });

interface WorkbookListing {
  id: string;
  name: string;
  state: string;
  certified_by: string | null;
}

type RefreshHandler = (sourceId: string) => Promise<void>;

export class App {
  readonly clock = new Clock();
  readonly db: Database;
  readonly storage: Storage;
  readonly events: EventHub;
  readonly limiters: { login: RateLimiter; formula: RateLimiter; query: RateLimiter };
  /** The export worker reads `exportsPaused`; the grading route writes it. */
  readonly flags = { exportsPaused: false };
  readonly routes: Route[] = [];
  readonly schemaStatements: string[] = [];
  readonly seedSteps: SeedStep[] = [];
  /** The workbooks of a project a user may see. The workbook module replaces this. */
  workbooksOf: (projectId: string, userId: string, role: Role) => Promise<WorkbookListing[]> = async () => [];
  private readonly refreshHandlers: RefreshHandler[] = [];

  constructor(readonly config: Config) {
    this.db = new Database(config.databaseUrl);
    this.storage = new Storage(config.s3);
    this.events = new EventHub(config.sseHeartbeatMs);
    this.limiters = {
      login: new RateLimiter(config.loginRate),
      formula: new RateLimiter(config.formulaRate),
      query: new RateLimiter(config.queryRate),
    };
  }

  /** A route that needs a signed-in user (401 otherwise). */
  route(def: RouteDef): void {
    this.routes.push({ ...def, open: false });
  }

  /** A route anyone may call; `ctx.user` is null when nobody is signed in. */
  publicRoute(def: PublicRouteDef): void {
    this.routes.push({ ...def, open: true });
  }

  /** Idempotent DDL (`CREATE TABLE IF NOT EXISTS`, ...), applied in registration order at every start. */
  schema(statements: readonly string[]): void {
    this.schemaStatements.push(...statements);
  }

  /** Runs after every successful refresh, once its snapshot has swapped in (the transaction committed). */
  onRefreshed(handler: RefreshHandler): void {
    this.refreshHandlers.push(handler);
  }

  /** Tells every `onRefreshed` handler, in registration order; one handler's failure does not stop the others. */
  async refreshed(sourceId: string): Promise<void> {
    for (const handler of this.refreshHandlers) {
      await handler(sourceId).catch((error: unknown) => {
        console.error('refresh handler failed:', error instanceof Error ? error.message : 'unknown error');
      });
    }
  }

  /** A step of `POST /api/grading/seed`; steps run in ascending `order`. */
  seedStep(step: SeedStep): void {
    this.seedSteps.push(step);
    this.seedSteps.sort((a, b) => a.order - b.order);
  }
}

export type Module = (app: App) => void;
