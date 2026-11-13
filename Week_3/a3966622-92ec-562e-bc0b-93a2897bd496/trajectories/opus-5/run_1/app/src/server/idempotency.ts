import { createHash } from 'node:crypto';
import { formatInstantSeconds } from '../domain/porttime.ts';
import { ApiError } from './errors.ts';
import type { Store } from './store/store.ts';
import type { UserRecord } from './store/types.ts';

export type StoredReply = { status: number; json: unknown };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(body) ?? null)).digest('hex');
}

type InFlight = { method: string; path: string; hash: string; reply: Promise<StoredReply> };

/** A key belongs to the user who sent it; an identical request returns the stored reply. */
export class Idempotency {
  private readonly store: Store;
  private readonly inFlight = new Map<string, InFlight>();

  constructor(store: Store) {
    this.store = store;
  }

  async run(
    user: UserRecord,
    key: string,
    method: string,
    path: string,
    body: unknown,
    handler: () => Promise<StoredReply>,
  ): Promise<StoredReply> {
    const hash = bodyHash(body);
    const slot = `${user.id}:${key}`;
    const stored = this.store
      .read()
      .idempotency.find((entry) => entry.key === key && entry.user_id === user.id);
    if (stored !== undefined) {
      if (stored.method !== method || stored.path !== path || stored.body_hash !== hash) {
        throw this.keyConflict();
      }
      return { status: stored.status, json: stored.response };
    }
    const running = this.inFlight.get(slot);
    if (running !== undefined) {
      if (running.method !== method || running.path !== path || running.hash !== hash) {
        throw this.keyConflict();
      }
      return running.reply;
    }
    const reply = (async () => {
      const result = await handler();
      if (result.status < 500 && result.status !== 202) {
        this.store.mutate((state) => {
          state.idempotency.push({
            key,
            user_id: user.id,
            method,
            path,
            body_hash: hash,
            status: result.status,
            response: result.json,
            created_at: formatInstantSeconds(Date.now()),
          });
        });
      }
      return result;
    })();
    this.inFlight.set(slot, { method, path, hash, reply });
    try {
      return await reply;
    } finally {
      this.inFlight.delete(slot);
    }
  }

  private keyConflict(): ApiError {
    return new ApiError(
      409,
      'idempotency_conflict',
      'That idempotency key was used with a different request',
    );
  }
}
