import { randomUUID } from 'node:crypto';
import { nowMs } from '../clock.js';
import { hashKey, membershipsOf, newKeyValue, type Role } from '../auth.js';
import { one, query } from '../db.js';
import { fail } from '../errors.js';
import { route, type ResolvedResource } from '../http.js';
import { currentSeq } from '../live.js';
import { generationsOf, loadRange, streamByName } from '../store.js';
import { buildTrace, validateSpans, type SpanInput } from '../domain/trace.js';
import {
  budgetRemaining,
  burnRate,
  LONG_WINDOW_MS,
  objectiveStatus,
  SHORT_WINDOW_MS,
} from '../domain/objectives.js';
import { valuesOf } from '../domain/mapping.js';

const SLUG = /^[a-z0-9-]{1,40}$/;
const ROLES: Role[] = ['viewer', 'editor', 'admin'];
const ACTIONS = ['read', 'upload', 'manage'];

type BadFilter = { field: string; op: string; value: unknown };

function badMatches(fields: Record<string, unknown>, bad: BadFilter): boolean {
  const values = valuesOf(fields[bad.field] as never);
  if (bad.op === 'exists') return values.length > 0;
  if (bad.op === 'ne') return !values.some((value) => String(value) === String(bad.value));
  if (bad.op === 'eq') return values.some((value) => String(value) === String(bad.value));
  const bound = Number(bad.value);
  return values.some((value) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return false;
    switch (bad.op) {
      case 'gt':
        return numeric > bound;
      case 'gte':
        return numeric >= bound;
      case 'lt':
        return numeric < bound;
      case 'lte':
        return numeric <= bound;
      default:
        return false;
    }
  });
}

async function objectiveCounts(
  spaceId: number,
  streamName: string,
  service: string,
  bad: BadFilter,
  windowMs: number,
): Promise<{ bad: number; total: number }> {
  const stream = await streamByName(spaceId, streamName);
  if (!stream) return { bad: 0, total: 0 };
  const to = nowMs() + 1;
  const generations = await generationsOf(stream.id);
  const load = await loadRange(stream, to - windowMs, to, generations);
  let total = 0;
  let badCount = 0;
  for (const event of load.events) {
    const serviceValues = valuesOf(event.fields.service);
    if (!serviceValues.some((value) => String(value) === service)) continue;
    total += 1;
    if (badMatches(event.fields as Record<string, unknown>, bad)) badCount += 1;
  }
  return { bad: badCount, total };
}

async function traceResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select id from traces where space_id = $1 and trace_id = $2`, [
    space.id,
    params.id,
  ]);
  return row === null ? null : { value: row };
}

async function keyResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select id from api_keys where id = $1 and space_id = $2`, [params.id, space.id]);
  return row === null ? null : { value: row };
}

async function savedSearchResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select id from saved_searches where id = $1 and space_id = $2`, [
    params.id,
    space.id,
  ]);
  return row === null ? null : { value: row };
}

export function registerMiscRoutes(): void {
  route({
    method: 'POST',
    path: '/api/traces',
    auth: 'session',
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const traceId = String(ctx.body.trace_id ?? '');
      if (traceId === '') throw fail.invalid({ trace_id: 'Enter a trace id.' });
      const spansInput = ctx.body.spans;
      if (!Array.isArray(spansInput)) throw fail.invalid({ spans: 'Send a list of spans.' });
      const spans = spansInput as SpanInput[];
      const fields: Record<string, string> = {};
      spans.forEach((span, index) => {
        if (
          typeof span.span_id !== 'string' ||
          typeof span.service !== 'string' ||
          typeof span.name !== 'string' ||
          !Number.isInteger(span.start_ms) ||
          !Number.isInteger(span.duration_ms) ||
          span.duration_ms < 0
        ) {
          fields[`spans.${index}`] = 'A span needs an id, service, name and whole millisecond times.';
        }
      });
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      const taken = await one(`select 1 from traces where space_id = $1 and trace_id = $2`, [
        ctx.space.id,
        traceId,
      ]);
      if (taken) throw fail.nameTaken({ trace_id: 'That name is already used.' });
      const problem = validateSpans(spans);
      if (problem) throw fail.traceInvalid(problem);
      await query(
        `insert into traces (space_id, trace_id, spans, at_ms) values ($1, $2, $3, $4)`,
        [ctx.space.id, traceId, JSON.stringify(spans), nowMs()],
      );
      return { status: 201, body: { trace_id: traceId, spans: spans.length, seq: await currentSeq(ctx.space.id) } };
    },
  });

  route({
    method: 'GET',
    path: '/api/traces',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rows = await query(
        `select trace_id, spans, at_ms from traces where space_id = $1 order by at_ms desc, id desc`,
        [ctx.space.id],
      );
      return {
        status: 200,
        body: {
          traces: rows.map((row) => ({
            trace_id: String(row.trace_id),
            spans: (row.spans as SpanInput[]).length,
            at: new Date(Number(row.at_ms)).toISOString(),
          })),
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/traces/:id',
    auth: 'session',
    resource: traceResource,
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const row = await one(`select trace_id, spans from traces where space_id = $1 and trace_id = $2`, [
        ctx.space.id,
        ctx.params.id,
      ]);
      if (!row) throw fail.notFound();
      const view = buildTrace(row.spans as SpanInput[]);
      return { status: 200, body: { trace_id: String(row.trace_id), ...view } };
    },
  });

  route({
    method: 'GET',
    path: '/api/objectives',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rows = await query(`select * from objectives where space_id = $1 order by service asc`, [
        ctx.space.id,
      ]);
      const objectives = [];
      for (const row of rows) {
        const target = Number(row.target);
        const bad = row.bad as BadFilter;
        const fixedCounts = row.counts as {
          objective?: { bad: number; total: number };
          long?: { bad: number; total: number };
          short?: { bad: number; total: number };
        } | null;
        const objectiveWindowMs = Number(row.objective_window_ms);
        const windowCounts = fixedCounts?.objective
          ? fixedCounts.objective
          : await objectiveCounts(
              ctx.space.id,
              String(row.stream_name),
              String(row.service),
              bad,
              objectiveWindowMs,
            );
        const longCounts = fixedCounts?.long
          ? fixedCounts.long
          : await objectiveCounts(
              ctx.space.id,
              String(row.stream_name),
              String(row.service),
              bad,
              LONG_WINDOW_MS,
            );
        const shortCounts = fixedCounts?.short
          ? fixedCounts.short
          : await objectiveCounts(
              ctx.space.id,
              String(row.stream_name),
              String(row.service),
              bad,
              SHORT_WINDOW_MS,
            );
        const long = burnRate(longCounts, target);
        const short = burnRate(shortCounts, target);
        objectives.push({
          id: String(row.id),
          service: String(row.service),
          name: String(row.name),
          stream: String(row.stream_name),
          target,
          objective_window_ms: objectiveWindowMs,
          objective: { bad: windowCounts.bad, total: windowCounts.total },
          budget_remaining: budgetRemaining(windowCounts, target),
          long: { bad: longCounts.bad, total: longCounts.total, burn: long },
          short: { bad: shortCounts.bad, total: shortCounts.total, burn: short },
          status: objectiveStatus(long, short),
        });
      }
      return { status: 200, body: { objectives } };
    },
  });

  route({
    method: 'POST',
    path: '/api/objectives',
    auth: 'session',
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const service = String(ctx.body.service ?? '');
      const name = String(ctx.body.name ?? '');
      const streamName = String(ctx.body.stream ?? '');
      const target = Number(ctx.body.target);
      const fields: Record<string, string> = {};
      if (service === '') fields.service = 'Enter a service.';
      if (name === '') fields.name = 'Enter a name.';
      const stream = await streamByName(ctx.space.id, streamName);
      if (!stream) fields.stream = 'Choose a stream.';
      if (!Number.isFinite(target) || target <= 0 || target >= 100) {
        fields.target = 'Enter a target above 0 and below 100.';
      }
      const bad = ctx.body.bad as BadFilter | undefined;
      if (!bad || typeof bad.field !== 'string' || typeof bad.op !== 'string') {
        fields.bad = 'A bad filter needs a field and an operator.';
      }
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      const taken = await one(`select 1 from objectives where space_id = $1 and service = $2`, [
        ctx.space.id,
        service,
      ]);
      if (taken) throw fail.nameTaken({ service: 'That name is already used.' });
      const id = randomUUID();
      const windowMs = Number(ctx.body.objective_window_ms ?? 2592000000);
      await query(
        `insert into objectives (id, space_id, service, name, stream_name, target, objective_window_ms, bad)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, ctx.space.id, service, name, streamName, target, windowMs, JSON.stringify(bad)],
      );
      return { status: 201, body: { id, service, name, target, seq: await currentSeq(ctx.space.id) } };
    },
  });

  route({
    method: 'GET',
    path: '/api/spaces',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      if (ctx.caller.kind !== 'session') throw fail.unauthenticated();
      const memberships = await membershipsOf(ctx.caller.user.id);
      const members = await query(
        `select u.username, m.role from members m join users u on u.id = m.user_id
         where m.space_id = $1 order by u.username asc`,
        [ctx.space.id],
      );
      return {
        status: 200,
        body: {
          spaces: memberships.map((membership) => ({
            slug: membership.slug,
            name: membership.name,
            role: membership.role,
          })),
          members: members.map((row) => ({
            username: String(row.username),
            role: String(row.role),
          })),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/spaces',
    auth: 'session',
    space: false,
    body: 'json',
    handler: async (ctx) => {
      if (ctx.caller.kind !== 'session') throw fail.unauthenticated();
      const slug = String(ctx.body.slug ?? '');
      const name = String(ctx.body.name ?? '');
      const fields: Record<string, string> = {};
      if (!SLUG.test(slug)) fields.slug = 'Use 1 to 40 characters: a-z, 0-9 or -.';
      if (name.trim() === '') fields.name = 'Enter a space name.';
      const taken = await one(`select 1 from spaces where slug = $1`, [slug]);
      if (taken) throw fail.nameTaken({ slug: 'That name is already used.' });
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      const created = await one<{ id: number }>(
        `insert into spaces (slug, name) values ($1, $2) returning id`,
        [slug, name],
      );
      await query(`insert into members (space_id, user_id, role) values ($1, $2, 'admin')`, [
        Number(created?.id),
        ctx.caller.user.id,
      ]);
      return { status: 201, body: { slug, name, seq: 0 } };
    },
  });

  route({
    method: 'POST',
    path: '/api/spaces/:slug/members',
    auth: 'session',
    space: true,
    role: 'admin',
    body: 'json',
    handler: async (ctx) => {
      if (ctx.space.slug !== ctx.params.slug) {
        const membership =
          ctx.caller.kind === 'session'
            ? (await membershipsOf(ctx.caller.user.id)).find((item) => item.slug === ctx.params.slug)
            : undefined;
        if (!membership) throw fail.notFound();
        if (membership.role !== 'admin') throw fail.forbidden();
      }
      const spaceRow = await one(`select id from spaces where slug = $1`, [ctx.params.slug]);
      if (!spaceRow) throw fail.notFound();
      const username = String(ctx.body.username ?? '').toLowerCase();
      const role = String(ctx.body.role ?? '') as Role;
      if (!ROLES.includes(role)) throw fail.invalid({ role: 'Choose a role.' });
      const user = await one(`select id from users where username = $1`, [username]);
      if (!user) throw fail.notFound();
      const already = await one(`select 1 from members where space_id = $1 and user_id = $2`, [
        Number(spaceRow.id),
        Number(user.id),
      ]);
      if (already) throw fail.nameTaken({ username: 'That name is already used.' });
      await query(`insert into members (space_id, user_id, role) values ($1, $2, $3)`, [
        Number(spaceRow.id),
        Number(user.id),
        role,
      ]);
      return { status: 201, body: { username, role } };
    },
  });

  route({
    method: 'GET',
    path: '/api/keys',
    auth: 'session',
    space: true,
    role: 'admin',
    body: 'none',
    handler: async (ctx) => {
      const rows = await query(`select * from api_keys where space_id = $1 order by created_ms desc`, [
        ctx.space.id,
      ]);
      return { status: 200, body: { keys: rows.map(serializeKey) } };
    },
  });

  route({
    method: 'POST',
    path: '/api/keys',
    auth: 'session',
    space: true,
    role: 'admin',
    body: 'json',
    handler: async (ctx) => {
      const name = String(ctx.body.name ?? '');
      const pattern = String(ctx.body.stream_pattern ?? '');
      const actions = Array.isArray(ctx.body.actions) ? (ctx.body.actions as string[]) : [];
      const expiresInDays =
        ctx.body.expires_in_days === null || ctx.body.expires_in_days === undefined || ctx.body.expires_in_days === ''
          ? null
          : Number(ctx.body.expires_in_days);
      const fields: Record<string, string> = {};
      if (name.trim() === '') fields.name = 'Enter a key name.';
      if (pattern.trim() === '') fields.stream_pattern = 'Enter a stream pattern.';
      if (actions.length === 0 || actions.some((action) => !ACTIONS.includes(action))) {
        fields.actions = 'Choose read, upload or manage.';
      }
      if (
        expiresInDays !== null &&
        (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)
      ) {
        fields.expires_in_days = 'Enter a whole number of days from 1 to 365.';
      }
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      const value = newKeyValue();
      const id = randomUUID();
      const created = nowMs();
      const expiresMs = expiresInDays === null ? null : created + expiresInDays * 86400000;
      await query(
        `insert into api_keys (id, space_id, name, key_hash, stream_pattern, actions, created_ms, expires_ms, last4)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          ctx.space.id,
          name,
          hashKey(value),
          pattern,
          JSON.stringify(actions),
          created,
          expiresMs,
          value.slice(-4),
        ],
      );
      return {
        status: 201,
        body: {
          id,
          name,
          stream_pattern: pattern,
          actions,
          expires_at: expiresMs === null ? null : new Date(expiresMs).toISOString(),
          revoked: false,
          last4: value.slice(-4),
          key: value,
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });

  route({
    method: 'DELETE',
    path: '/api/keys/:id',
    auth: 'session',
    resource: keyResource,
    space: true,
    role: 'admin',
    body: 'none',
    handler: async (ctx) => {
      const row = await one(`select * from api_keys where id = $1 and space_id = $2`, [
        ctx.params.id,
        ctx.space.id,
      ]);
      if (!row) throw fail.notFound();
      const updated = await one(`update api_keys set revoked = true where id = $1 returning *`, [
        ctx.params.id,
      ]);
      return { status: 200, body: { ...serializeKey(updated as Record<string, unknown>), seq: await currentSeq(ctx.space.id) } };
    },
  });

  route({
    method: 'GET',
    path: '/api/saved-searches',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rows = await query(`select * from saved_searches where space_id = $1 order by name asc`, [
        ctx.space.id,
      ]);
      const body = [];
      for (const row of rows) {
        const stream = await streamByName(ctx.space.id, String(row.stream_name));
        body.push({ ...serializeSavedSearch(row), needs_attention: stream === null });
      }
      return { status: 200, body: { saved_searches: body } };
    },
  });

  route({
    method: 'POST',
    path: '/api/saved-searches',
    auth: 'session',
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const name = String(ctx.body.name ?? '');
      const streamName = String(ctx.body.stream ?? '');
      const fields: Record<string, string> = {};
      if (name.trim() === '') fields.name = 'Enter a search name.';
      if (streamName.trim() === '') fields.stream = 'Choose a stream.';
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      const id = randomUUID();
      await query(
        `insert into saved_searches (id, space_id, name, stream_name, q, filters, from_iso, to_iso)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          ctx.space.id,
          name,
          streamName,
          String(ctx.body.q ?? ''),
          JSON.stringify(ctx.body.filters ?? []),
          String(ctx.body.from ?? ''),
          String(ctx.body.to ?? ''),
        ],
      );
      return { status: 201, body: { id, name, stream: streamName, seq: await currentSeq(ctx.space.id) } };
    },
  });

  route({
    method: 'GET',
    path: '/api/saved-searches/:id',
    auth: 'session',
    resource: savedSearchResource,
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const row = await one(`select * from saved_searches where id = $1 and space_id = $2`, [
        ctx.params.id,
        ctx.space.id,
      ]);
      if (!row) throw fail.notFound();
      const stream = await streamByName(ctx.space.id, String(row.stream_name));
      const body: Record<string, unknown> = serializeSavedSearch(row);
      if (!stream) body.problem = `Stream ${String(row.stream_name)} doesn't exist in this space.`;
      return { status: 200, body };
    },
  });

  route({
    method: 'POST',
    path: '/api/saved-searches/:id/copy',
    auth: 'session',
    resource: savedSearchResource,
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      if (ctx.caller.kind !== 'session') throw fail.unauthenticated();
      const row = await one(`select * from saved_searches where id = $1 and space_id = $2`, [
        ctx.params.id,
        ctx.space.id,
      ]);
      if (!row) throw fail.notFound();
      const targetSlug = String(ctx.body.space ?? '');
      const membership = (await membershipsOf(ctx.caller.user.id)).find(
        (item) => item.slug === targetSlug,
      );
      if (!membership) throw fail.notFound();
      if (membership.role === 'viewer') throw fail.forbidden();
      const stream = await streamByName(membership.spaceId, String(row.stream_name));
      const missing = stream ? [] : [`stream ${String(row.stream_name)}`];
      const id = randomUUID();
      await query(
        `insert into saved_searches (id, space_id, name, stream_name, q, filters, from_iso, to_iso)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          membership.spaceId,
          String(row.name),
          String(row.stream_name),
          String(row.q),
          JSON.stringify(row.filters),
          String(row.from_iso),
          String(row.to_iso),
        ],
      );
      const message =
        missing.length === 0
          ? 'Copied with no missing references.'
          : `Copied with ${missing.length} missing reference${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`;
      return {
        status: 201,
        body: {
          id,
          space: targetSlug,
          missing,
          needs_attention: missing.length > 0,
          message,
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });
}

function serializeKey(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    name: String(row.name),
    stream_pattern: String(row.stream_pattern),
    actions: row.actions as string[],
    expires_at: row.expires_ms === null ? null : new Date(Number(row.expires_ms)).toISOString(),
    revoked: Boolean(row.revoked),
    last4: String(row.last4),
  };
}

function serializeSavedSearch(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    name: String(row.name),
    stream: String(row.stream_name),
    q: String(row.q),
    filters: row.filters,
    from: String(row.from_iso),
    to: String(row.to_iso),
  };
}

