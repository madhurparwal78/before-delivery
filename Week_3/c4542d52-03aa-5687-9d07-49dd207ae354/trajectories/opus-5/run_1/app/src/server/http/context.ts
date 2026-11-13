import type { IncomingHttpHeaders } from "node:http";
import type { Role } from "../../shared/types.js";
import type { PersonRow } from "../model/people.js";
import { forbidden, unauthenticated } from "./errors.js";

export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingHttpHeaders;
  person: PersonRow | null;
  now: Date;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
}

export type Handler = (context: RequestContext) => Promise<ApiResponse>;

export function requirePerson(context: RequestContext): PersonRow {
  if (context.person === null) throw unauthenticated();
  return context.person;
}

export function requireRole(context: RequestContext, ...roles: Role[]): PersonRow {
  const person = requirePerson(context);
  if (!roles.includes(person.role)) throw forbidden();
  return person;
}

export function json(body: unknown, status = 200): ApiResponse {
  return { status, body };
}
