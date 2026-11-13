import type { ProjectRole } from '../../shared/types.js';
import type { ClusterRow, PersonRow, ProjectRow } from '../repo.js';
import type { Json } from '../validate.js';

export interface Reply {
  status: number;
  json?: unknown;
  raw?: Buffer;
  headers?: Record<string, string>;
}

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Json;
  rawBody: unknown;
  person: PersonRow | null;
  cluster: ClusterRow | null;
  sessionToken: string | null;
}

export interface Membership {
  project: ProjectRow;
  role: ProjectRole;
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path template with `:name` placeholders, for example `/api/projects/:project/graph`. */
  template: string;
  access: 'public' | 'session' | 'agent';
  bodyLimit?: number;
  handler: Handler;
  /**
   * Keyed routes resolve the resource and the caller's role here, because an unknown resource
   * and a refused role both answer before the request key is even read.
   */
  authorize?: (ctx: Ctx) => Promise<void>;
}
