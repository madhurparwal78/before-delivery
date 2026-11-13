import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../../shared/api.js';
import type { Chair } from '../../shared/api.js';

export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  chair: Chair | null;
}

export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  rawBody: Buffer;
  jsonBody: unknown;
  person: Person | null;
  nowMs: number;
}

export function signedInPerson(context: RequestContext): Person {
  if (!context.person) throw new Error('route reached without a session');
  return context.person;
}

export function hasRole(person: Person, roles: readonly Role[]): boolean {
  return roles.includes(person.role);
}

export const LIBRARIANS: readonly Role[] = ['principal_librarian', 'assistant_librarian'];
export const DESK_ROLES: readonly Role[] = ['principal_librarian', 'assistant_librarian', 'section_principal'];
export const FOLDER_ROLES: readonly Role[] = ['player', 'section_principal'];
