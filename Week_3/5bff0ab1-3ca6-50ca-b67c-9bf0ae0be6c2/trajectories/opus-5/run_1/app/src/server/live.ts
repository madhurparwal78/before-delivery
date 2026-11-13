import type { ServerResponse } from 'node:http';
import { SESSION_HOURS, type FinishId, type HubId, type ModelId } from '../shared/catalogue.js';
import { appNow } from './clock.js';
import { query } from './db.js';
import { liveReading } from './domain/reading.js';
import { readSeqs } from './domain/hubstate.js';

const PING_MS = 10_000;
const LOOP_MS = 1_000;

interface StreamClient {
  response: ServerResponse;
  hub: HubId;
  model: ModelId;
  finish: FinishId;
  token: string | null;
  userId: string | null;
  lastSeq: number;
  lastRev: number | null;
  lastHour: number;
  lastPing: number;
  sessionTold: boolean;
}

const clients = new Set<StreamClient>();
let loop: NodeJS.Timeout | null = null;

function hourIndex(at: Date): number {
  return Math.floor((at.getTime() + 330 * 60_000) / 3_600_000);
}

function write(client: StreamClient, event: string, data: unknown): void {
  try {
    client.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

export async function openStream(options: {
  response: ServerResponse;
  hub: HubId;
  model: ModelId;
  finish: FinishId;
  token: string | null;
  userId: string | null;
}): Promise<void> {
  const { response } = options;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const now = appNow();
  const client: StreamClient = {
    response,
    hub: options.hub,
    model: options.model,
    finish: options.finish,
    token: options.token,
    userId: options.userId,
    lastSeq: -1,
    lastRev: null,
    lastHour: hourIndex(now),
    lastPing: Date.now(),
    sessionTold: false,
  };
  clients.add(client);
  response.on('close', () => {
    clients.delete(client);
  });
  const reading = await liveReading(client.hub, client.model, client.finish, client.userId);
  client.lastSeq = reading.seq;
  write(client, 'live', reading);
  if (client.userId) {
    const rows = await query<{ rev: number }>('select rev from users where id = $1', [
      client.userId,
    ]);
    client.lastRev = rows[0]?.rev ?? null;
  }
  startLiveLoop();
}

export function startLiveLoop(): void {
  if (loop) return;
  loop = setInterval(() => {
    void pass();
  }, LOOP_MS);
}

let passing = false;

async function pass(): Promise<void> {
  if (passing || clients.size === 0) return;
  passing = true;
  try {
    const now = appNow();
    const seqs = await readSeqs();
    const userIds = [...new Set([...clients].map((c) => c.userId).filter((id): id is string => !!id))];
    const tokens = [...new Set([...clients].map((c) => c.token).filter((t): t is string => !!t))];
    const revs = new Map<string, number>();
    const holders = new Set<string>();
    if (userIds.length > 0) {
      for (const row of await query<{ id: string; rev: number }>(
        'select id, rev from users where id = any($1::text[])',
        [userIds],
      )) {
        revs.set(row.id, row.rev);
      }
      for (const row of await query<{ rider_id: string }>(
        `select distinct rider_id from locks
          where rider_id = any($1::text[]) and state in ('requested','locked','delivery_set')`,
        [userIds],
      )) {
        holders.add(row.rider_id);
      }
    }
    const sessionState = new Map<string, 'live' | 'ended' | 'signed_out'>();
    if (tokens.length > 0) {
      for (const row of await query<{ token: string; created_at: Date; ended_by: string | null }>(
        'select token, created_at, ended_by from sessions where token = any($1::text[])',
        [tokens],
      )) {
        const ended = now.getTime() - row.created_at.getTime() >= SESSION_HOURS * 3_600_000;
        sessionState.set(
          row.token,
          row.ended_by ? 'signed_out' : ended ? 'ended' : 'live',
        );
      }
      for (const token of tokens) if (!sessionState.has(token)) sessionState.set(token, 'ended');
    }
    const readings = new Map<string, unknown>();
    for (const client of [...clients]) {
      if (client.token && !client.sessionTold) {
        const state = sessionState.get(client.token);
        if (state && state !== 'live') {
          client.sessionTold = true;
          client.userId = null;
          write(client, 'session', { state: state === 'signed_out' ? 'signed_out' : 'ended' });
        }
      }
      const seq = seqs.get(client.hub) ?? 0;
      if (seq !== client.lastSeq) {
        const key = `${client.hub}|${client.model}|${client.finish}|${client.userId ?? ''}`;
        let reading = readings.get(key);
        if (!reading) {
          reading = await liveReading(client.hub, client.model, client.finish, client.userId);
          readings.set(key, reading);
        }
        client.lastSeq = seq;
        write(client, 'live', reading);
      }
      if (client.userId) {
        const rev = revs.get(client.userId) ?? null;
        const hour = hourIndex(now);
        const hourTurned = hour !== client.lastHour && holders.has(client.userId);
        if ((rev !== null && rev !== client.lastRev) || hourTurned) {
          client.lastRev = rev;
          client.lastHour = hour;
          write(client, 'mine', {});
        }
        client.lastHour = hour;
      }
      if (Date.now() - client.lastPing >= PING_MS) {
        client.lastPing = Date.now();
        write(client, 'ping', {});
      }
    }
  } catch {
    /* the next pass reads Postgres again */
  } finally {
    passing = false;
  }
}

/** A fan-out hint only shortens the wait; the pass itself re-reads Postgres. */
export function nudge(): void {
  void pass();
}
