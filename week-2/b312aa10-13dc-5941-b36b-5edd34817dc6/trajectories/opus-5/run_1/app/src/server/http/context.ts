import type { IncomingMessage } from 'node:http';
import { errors } from './errors.js';
import type { Kitchen, Person, Role } from '../domain/types.js';

export const jsonBodyLimit = 100_000;
export const uploadFileLimit = 5_000_000;
export const uploadRequestLimit = 5_200_000;

export type RequestContext = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  origin: string;
  nowMs: number;
  body: Buffer;
  json: unknown;
  idempotencyKey: string | null;
  sessionId: string | null;
  person: Person | null;
  kitchen: Kitchen | null;
};

export type SignedContext = RequestContext & { person: Person; kitchen: Kitchen };

export function readHeader(context: RequestContext, name: string): string | null {
  const value = context.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Reads a body up to its limit, draining the rest so the 413 still reaches the client. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let overLimit = false;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > limit) {
      overLimit = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (overLimit) throw errors.payloadTooLarge();
  return Buffer.concat(chunks);
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

export function requireRole(context: RequestContext, roles: Role[]): SignedContext {
  const signed = context as SignedContext;
  if (!roles.includes(signed.person.role)) throw errors.forbidden();
  return signed;
}

export function signed(context: RequestContext): SignedContext {
  return context as SignedContext;
}

/** A member caller may only ever name their own member id. */
export function requireOwnMember(context: SignedContext, memberId: string): void {
  if (context.person.role === 'member' && context.person.memberId !== memberId) {
    throw errors.notFound();
  }
}
