import { hashKey, hashPassword } from './auth.js';
import { nowMs } from './clock.js';
import { one, query, transaction } from './db.js';
import {
  createGeneration,
  generationsOf,
  streamByName,
  writeEvent,
  type GenerationRow,
  type StreamRow,
} from './store.js';
import type { FieldType } from './domain/mapping.js';
import type { Processor } from './domain/pipeline.js';

export type SeedEvent = Record<string, unknown>;

export async function ensureUser(
  username: string,
  password: string,
  timeZone: string,
): Promise<number> {
  const existing = await one<{ id: number }>(`select id from users where username = $1`, [username]);
  if (existing) return Number(existing.id);
  const hash = await hashPassword(password);
  const created = await one<{ id: number }>(
    `insert into users (username, password_hash, time_zone) values ($1, $2, $3) returning id`,
    [username, hash, timeZone],
  );
  return Number(created?.id);
}

export async function ensureSpace(slug: string, name: string): Promise<number> {
  const created = await one<{ id: number }>(
    `insert into spaces (slug, name) values ($1, $2)
     on conflict (slug) do update set name = excluded.name returning id`,
    [slug, name],
  );
  return Number(created?.id);
}

export async function ensureMember(spaceId: number, userId: number, role: string): Promise<void> {
  await query(
    `insert into members (space_id, user_id, role) values ($1, $2, $3)
     on conflict (space_id, user_id) do update set role = excluded.role`,
    [spaceId, userId, role],
  );
}

export async function ensureStream(spaceId: number, name: string): Promise<StreamRow> {
  const existing = await streamByName(spaceId, name);
  if (existing) return existing;
  await query(`insert into streams (space_id, name) values ($1, $2)`, [spaceId, name]);
  const stream = await streamByName(spaceId, name);
  await createGeneration(stream!.id, 1, 'hot', nowMs());
  return stream!;
}

export async function ensureExplicitMapping(
  generationId: number,
  field: string,
  type: FieldType,
): Promise<void> {
  await query(
    `insert into mappings (generation_id, field, type, explicit) values ($1, $2, $3, true)
     on conflict (generation_id, field) do nothing`,
    [generationId, field, type],
  );
}

export async function seedEvent(
  spaceId: number,
  stream: StreamRow,
  generation: GenerationRow,
  event: SeedEvent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const timestamp = String(event['@timestamp'] ?? '');
  const tsMs = Date.parse(timestamp);
  if (!Number.isFinite(tsMs)) return { ok: false, reason: '@timestamp is not a date' };
  const eventId = typeof event._id === 'string' ? event._id : `seed-${tsMs}`;
  const outcome = await transaction((client) =>
    writeEvent(client, {
      spaceId,
      stream,
      generation,
      eventId,
      tsMs,
      raw: event,
      pipeline: null,
    }),
  );
  if (outcome.status === 'failed') return { ok: false, reason: outcome.reason };
  return { ok: true };
}

export async function ensurePipeline(
  spaceId: number,
  name: string,
  processors: Processor[],
): Promise<void> {
  await query(
    `insert into pipelines (space_id, name, version, processors) values ($1, $2, 1, $3)
     on conflict (space_id, name) do nothing`,
    [spaceId, name, JSON.stringify(processors)],
  );
}

export async function ensureKey(input: {
  spaceId: number;
  name: string;
  value: string;
  pattern: string;
  actions: string[];
  expiresMs: number | null;
}): Promise<string> {
  const existing = await one<{ id: string }>(
    `select id from api_keys where space_id = $1 and name = $2`,
    [input.spaceId, input.name],
  );
  if (existing) return String(existing.id);
  const id = `key-${input.spaceId}-${input.name}`;
  await query(
    `insert into api_keys (id, space_id, name, key_hash, stream_pattern, actions, created_ms, expires_ms, last4)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.spaceId,
      input.name,
      hashKey(input.value),
      input.pattern,
      JSON.stringify(input.actions),
      nowMs(),
      input.expiresMs,
      input.value.slice(-4),
    ],
  );
  return id;
}

const WEB_EVENTS: SeedEvent[] = [
  {
    _id: 'e-001',
    '@timestamp': '2026-02-28T23:46:10.000Z',
    host: 'host-3',
    level: 'info',
    service: 'web',
    status: 200,
    latency: 41,
    message: 'GET /cart served',
  },
  {
    _id: 'e-002',
    '@timestamp': '2026-02-28T23:48:30.000Z',
    host: 'host-7',
    level: 'error',
    service: 'web',
    status: 500,
    latency: 912,
    message: 'payment gateway timeout',
  },
  {
    _id: 'e-003',
    '@timestamp': '2026-02-28T23:50:05.000Z',
    host: 'host-7',
    level: 'error',
    service: 'web',
    status: 503,
    latency: 1204,
    message: 'gateway timeout, timeout again',
  },
  {
    _id: 'e-004',
    '@timestamp': '2026-02-28T23:51:40.000Z',
    host: 'host-2',
    level: 'warn',
    service: 'web',
    status: 200,
    latency: 388,
    message: 'retry scheduled',
  },
  {
    _id: 'e-005',
    '@timestamp': '2026-02-28T23:53:15.000Z',
    host: 'host-7',
    level: 'error',
    service: 'web',
    status: 500,
    latency: 77,
    message: 'disk full on node-7',
  },
  {
    _id: 'e-006',
    '@timestamp': '2026-02-28T23:55:00.000Z',
    host: 'host-3',
    level: 'info',
    service: 'web',
    status: 200,
    latency: 35,
    message: 'GET /search served',
  },
  {
    _id: 'e-007',
    '@timestamp': '2026-02-28T23:57:20.000Z',
    host: 'host-2',
    level: 'info',
    service: 'web',
    status: 200,
    latency: 52,
    message: 'GET /cart served',
  },
  {
    _id: 'e-008',
    '@timestamp': '2026-02-28T23:59:45.000Z',
    host: 'host-7',
    level: 'error',
    service: 'web',
    status: 502,
    latency: 640,
    message: 'upstream reset by peer',
  },
];

const PAY_EVENTS: SeedEvent[] = [
  {
    _id: 'h-001',
    '@timestamp': '2026-02-28T23:40:00.000Z',
    host: 'dock-1',
    level: 'info',
    message: 'refund queued',
  },
  {
    _id: 'h-002',
    '@timestamp': '2026-02-28T23:50:00.000Z',
    host: 'dock-1',
    level: 'error',
    message: 'ledger write failed',
  },
  {
    _id: 'h-003',
    '@timestamp': '2026-02-28T23:58:00.000Z',
    host: 'dock-2',
    level: 'info',
    message: 'refund sent',
  },
];

/** The start seed, applied idempotently on every boot. */
export async function applyStartSeed(): Promise<void> {
  const password = 'spoorline-demo-1';
  const ines = await ensureUser('ines', password, 'UTC');
  const tomas = await ensureUser('tomas', password, 'America/New_York');
  const ruth = await ensureUser('ruth', password, 'UTC');
  const wren = await ensureUser('wren', password, 'UTC');

  const ops = await ensureSpace('ops', 'Ops');
  const harbor = await ensureSpace('harbor', 'Harbor');
  await ensureMember(ops, ines, 'admin');
  await ensureMember(ops, tomas, 'editor');
  await ensureMember(ops, ruth, 'viewer');
  await ensureMember(harbor, wren, 'admin');
  await query(`update users set current_space_id = $2 where id = any($1) and current_space_id is null`, [
    [ines, tomas, ruth],
    ops,
  ]);
  await query(`update users set current_space_id = $2 where id = $1 and current_space_id is null`, [
    wren,
    harbor,
  ]);

  await ensureKey({
    spaceId: ops,
    name: 'edge-shipper',
    value: 'spk_5eedc0de5eedc0de5eedc0de5eedc0de',
    pattern: 'web*',
    actions: ['upload'],
    expiresMs: null,
  });

  await ensurePipeline(ops, 'web-clean', [
    { type: 'redact', field: 'message', pattern: 'ipv4' },
    { type: 'set', field: 'env', value: 'prod' },
  ]);

  const web = await ensureStream(ops, 'web');
  const webGenerations = await generationsOf(web.id);
  const webGeneration = webGenerations.find((generation) => generation.number === 1)!;
  await ensureExplicitMapping(webGeneration.id, 'host', 'keyword');
  await ensureExplicitMapping(webGeneration.id, 'level', 'keyword');
  await ensureExplicitMapping(webGeneration.id, 'service', 'keyword');
  for (const event of WEB_EVENTS) {
    await seedEvent(ops, web, webGeneration, event);
  }

  const pay = await ensureStream(harbor, 'pay');
  const payGenerations = await generationsOf(pay.id);
  const payGeneration = payGenerations.find((generation) => generation.number === 1)!;
  for (const event of PAY_EVENTS) {
    await seedEvent(harbor, pay, payGeneration, event);
  }
}
