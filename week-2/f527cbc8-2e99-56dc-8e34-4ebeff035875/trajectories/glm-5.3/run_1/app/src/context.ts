import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Row } from './db.js';
import type { AppError } from './errors.js';

export type Role = 'farrier' | 'apprentice' | 'owner' | 'barn_manager';

export interface Caller {
  type: 'session' | 'token';
  id: string;
  role: Role | 'farrier_token';
  name: string;
  email: string;
  scope?: 'read_only' | 'billing';
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  requestId: string;
  caller: Caller | null;
  address: string;
  requestIdLog: () => void;
}

/** Body reader helpers used by the context. */
export interface Body {
  json(): Promise<unknown>;
  raw: Buffer | null;
  contentType: string;
}

export type Db = import('./db.js').Db;

export type Query = (sql: string, params?: unknown[]) => Promise<Row[]>;

export function isFarrier(c: Caller | null): boolean {
  return !!c && (c.type === 'token' ? c.scope !== undefined : c.role === 'farrier');
}

export function isStaff(c: Caller | null): boolean {
  return !!c && c.type === 'session' && (c.role === 'farrier' || c.role === 'apprentice');
}

export type { AppError };
