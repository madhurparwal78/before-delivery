import type { Db } from './db';
import type { Storage } from './storage';
import type { Counters } from './counters';
import type { Queue } from './queue';
import type { Mail } from './mail';
import type { AppConfig } from './config';

/** Everything the routes need, in one object. */
export interface AppCtx {
  db: Db;
  config: AppConfig;
  storage: Storage;
  counters: Counters;
  queue: Queue;
  mail: Mail;
  live: LiveHub;
  workspaceId: string;
  ownerId: string;
}

/** The socket hub: one live connection per project or review page. */
export interface SocketEntry {
  ws: import('ws').WebSocket;
  projectId: string | null;
  reviewLinkId: string | null;
  personId: string | null;
  version?: number;
  closed?: boolean;
}

export interface LiveHub {
  register(entry: SocketEntry): SocketEntry;
  unregister(entry: SocketEntry): void;
  publishOp(projectId: string, message: Record<string, unknown>): void;
  publishComment(projectId: string, message: Record<string, unknown>): void;
  publishExport(projectId: string, message: Record<string, unknown>): void;
  publishAllowance(message: Record<string, unknown>): void;
  publishCutShared(projectId: string, message: Record<string, unknown>): void;
  roleChanged(projectId: string, personId: string, role: string | null): void;
  closeReview(reviewLinkId: string): void;
  closeSessionsOf(personId: string): void;
}
