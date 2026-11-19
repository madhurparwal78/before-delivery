import type { IncomingMessage, ServerResponse } from 'node:http';
import { errors } from './errors.js';
import { runOnce, type StoredResult } from './services/idempotency.js';
import { ensureProbed } from './services/valkey.js';
import type { Membership, SignedInUser } from './services/auth.js';

export interface RouteResult {
  status: number;
  body: unknown;
  cookie?: string;
}

export class Ctx {
  user: SignedInUser | null = null;
  membership: Membership | null = null;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
    readonly params: Record<string, string>,
    readonly query: URLSearchParams,
    readonly body: Record<string, unknown>,
    readonly instanceId: string,
    readonly key: string | null,
  ) {}

  get person(): SignedInUser {
    if (!this.user) throw errors.sessionRequired();
    return this.user;
  }

  get workspaceId(): string {
    return this.params['workspaceId'] ?? '';
  }

  /** Runs a keyed write exactly once; a repeat returns the stored result. */
  async once(work: () => Promise<RouteResult>): Promise<RouteResult> {
    if (!this.key || this.key.length < 1 || this.key.length > 128) {
      throw errors.idempotencyKeyRequired();
    }
    const scope = this.membership?.workspace_id ?? 'global';
    const stored: StoredResult = await runOnce(scope, this.person.id, this.key, this.body, async () => {
      const result = await work();
      return { status: result.status, body: result.body };
    });
    return { status: stored.status, body: stored.body };
  }

  requireRevision(current: number): void {
    const given = this.body['revision'];
    if (typeof given === 'number' && Number.isFinite(given) && given !== current) {
      throw errors.staleRevision();
    }
    if (typeof given !== 'number' || !Number.isFinite(given)) throw errors.invalidFields();
  }

  async requireValkey(): Promise<void> {
    if (!(await ensureProbed(1000))) throw errors.valkeyUnavailable();
  }

  text(name: string, maxLength = 200): string {
    const value = this.body[name];
    if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
      throw errors.invalidFields();
    }
    return value.trim();
  }

  optionalText(name: string, maxLength = 2000): string {
    const value = this.body[name];
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > maxLength) throw errors.invalidFields();
    return value;
  }

  whole(name: string, min: number, max: number): number {
    const value = this.body[name];
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw errors.invalidFields();
    }
    return value as number;
  }

  optionalWhole(name: string, min: number, max: number, fallback: number): number {
    if (this.body[name] === undefined || this.body[name] === null) return fallback;
    return this.whole(name, min, max);
  }

  choice<T extends string>(name: string, allowed: readonly T[]): T {
    const value = this.body[name];
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw errors.invalidFields();
    return value as T;
  }

  optionalId(name: string): string | null {
    const value = this.body[name];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 200) throw errors.invalidFields();
    return value;
  }

  flag(name: string): boolean {
    const value = this.body[name];
    if (typeof value !== 'boolean') throw errors.invalidFields();
    return value;
  }
}
