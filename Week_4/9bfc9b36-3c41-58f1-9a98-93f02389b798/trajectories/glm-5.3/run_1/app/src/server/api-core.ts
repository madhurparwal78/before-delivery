import type { Request, Response } from 'express';
import { Refusal } from '../domain/failure.ts';
import { words } from '../domain/words.ts';
import { fill } from '../domain/template.ts';
import type { Ctx } from './boot.ts';
import type { Caller } from './caller.ts';

export { Refusal, words, fill };

export function json(res: Response, status: number, body: unknown, headers?: Record<string, string>): void {
  const text = JSON.stringify(body);
  const buf = Buffer.from(text, 'utf8');
  res.status(status);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(buf.length));
  res.setHeader('cache-control', 'private, no-store');
  for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
  res.end(buf);
}

export function refuse(res: Response, refusal: Refusal): void {
  json(res, refusal.status, refusal.failure.body);
}

export function notFound(res: Response): void {
  json(res, 404, { error: 'not_found', message: words.errors.not_found });
}

export interface Route {
  method: string;
  path: string;
  roles: ('sailmaker' | 'loft-hand' | 'yacht-owner')[];
  handler: (req: Request, res: Response, ctx: Ctx, caller: Caller) => Promise<void>;
}

/** Collected field errors, answered together at the 422 rank. */
export class Invalid {
  private fields = new Map<string, string>();

  add(member: string, message: string): void {
    if (!this.fields.has(member)) this.fields.set(member, message);
  }

  throwIfAny(): void {
    if (this.fields.size === 0) return;
    throw new Refusal(422, 'invalid', words.errors.invalid, Object.fromEntries(this.fields));
  }
}
