import { randomUUID } from 'node:crypto';
import { nowMs } from '../clock.js';
import { one, query } from '../db.js';
import { settings } from '../env.js';
import { fail } from '../errors.js';
import { route, type Ctx, type ResolvedResource } from '../http.js';
import { subscribeTail } from '../live.js';
import { loadRange, streamByName } from '../store.js';
import { analyze, type AnalyzerName } from '../domain/analyze.js';
import { buildBuckets, chooseInterval } from '../domain/histogram.js';
import { valuesOf } from '../domain/mapping.js';
import { runPipe } from '../domain/pipe.js';
import {
  fieldStatistics,
  runMatch,
  serializeEvent,
  streamContext,
  type Filter,
  type FilterOp,
} from '../domain/search.js';
import { operatorItems, suggestTarget, valueInsert } from '../domain/suggest.js';
import { isKnownZone } from '../domain/tz.js';
import { streamFromQuery, streamOf } from './streams.js';

const FILTER_OPS: FilterOp[] = ['eq', 'ne', 'exists', 'gt', 'gte', 'lt', 'lte'];

function parseFilters(raw: string | null): Filter[] {
  if (!raw || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw fail.invalid({ filters: 'Send filters as a JSON list.' });
  }
  if (!Array.isArray(parsed)) throw fail.invalid({ filters: 'Send filters as a JSON list.' });
  return parsed.map((item) => {
    const filter = item as Filter;
    if (
      filter === null ||
      typeof filter !== 'object' ||
      typeof filter.field !== 'string' ||
      !FILTER_OPS.includes(filter.op)
    ) {
      throw fail.invalid({ filters: 'Each filter needs a field and an op.' });
    }
    return filter;
  });
}

function rangeOf(ctx: Ctx): { fromMs: number; toMs: number } {
  const to = ctx.url.searchParams.get('to');
  const from = ctx.url.searchParams.get('from');
  const toMs = to ? Date.parse(to) : nowMs();
  const fromMs = from ? Date.parse(from) : toMs - 900000;
  if (!Number.isFinite(toMs) || !Number.isFinite(fromMs)) {
    throw fail.invalid({ from: 'Enter a time as YYYY-MM-DD HH:MM:SS.' });
  }
  return { fromMs, toMs };
}

async function matchForRequest(ctx: Ctx, options: { explain?: boolean } = {}) {
  const stream = streamOf(ctx);
  const { fromMs, toMs } = rangeOf(ctx);
  return {
    stream,
    fromMs,
    toMs,
    outcome: await runMatch({
      stream,
      q: ctx.url.searchParams.get('q') ?? '',
      fromMs,
      toMs,
      filters: parseFilters(ctx.url.searchParams.get('filters')),
      sort: ctx.url.searchParams.get('sort'),
      nowMs: nowMs(),
      explain: options.explain ?? ctx.url.searchParams.get('explain') === 'true',
    }),
  };
}

async function snapshotResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select id from snapshots where id = $1 and space_id = $2`, [params.id, space.id]);
  return row === null ? null : { value: row };
}

export function registerSearchRoutes(): void {
  route({
    method: 'GET',
    path: '/api/search',
    auth: 'any',
    resource: streamFromQuery,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    rate: 'search',
    body: 'none',
    handler: async (ctx) => {
      const sizeRaw = ctx.url.searchParams.get('size');
      const size = sizeRaw === null ? 50 : Number(sizeRaw);
      const offset = Number(ctx.url.searchParams.get('offset') ?? '0');
      if (!Number.isInteger(size) || size < 1 || size > 100) {
        throw fail.invalid({ size: 'Use a size from 1 to 100.' });
      }
      if (!Number.isInteger(offset) || offset < 0) {
        throw fail.invalid({ offset: 'Use a whole offset.' });
      }
      if (offset + size > settings.resultWindow) throw fail.resultWindow();
      const explain = ctx.url.searchParams.get('explain') === 'true';
      const { outcome } = await matchForRequest(ctx, { explain });
      const id = ctx.url.searchParams.get('id');
      const hits = id ? outcome.hits.filter((hit) => hit.event.eventId === id) : outcome.hits.slice(offset, offset + size);
      return {
        status: 200,
        body: {
          total: outcome.total,
          events: hits.map((hit) => serializeEvent(hit, explain)),
          partial: outcome.partial,
          skipped_generations: outcome.skippedGenerations,
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/histogram',
    auth: 'any',
    resource: streamFromQuery,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    rate: 'search',
    body: 'none',
    handler: async (ctx) => {
      const zoneParam = ctx.url.searchParams.get('tz');
      const zone = zoneParam && isKnownZone(zoneParam) ? zoneParam : ctx.zone;
      const { fromMs, toMs, outcome } = await matchForRequest(ctx);
      const interval = chooseInterval(zone, fromMs, toMs);
      const buckets = buildBuckets(
        zone,
        fromMs,
        toMs,
        interval,
        outcome.hits.map((hit) => hit.event.tsMs),
      );
      return {
        status: 200,
        body: {
          interval,
          buckets: buckets.map((bucket) => ({
            start: new Date(bucket.start).toISOString(),
            end: new Date(bucket.end).toISOString(),
            count: bucket.count,
            label: bucket.label,
          })),
          total: outcome.total,
          partial: outcome.partial,
          skipped_generations: outcome.skippedGenerations,
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/fields',
    auth: 'any',
    resource: streamFromQuery,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    rate: 'search',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const { fromMs, toMs } = rangeOf(ctx);
      const { context } = await streamContext(stream, fromMs, toMs);
      return {
        status: 200,
        body: {
          fields: context.fields.map((field) => {
            const entry: Record<string, unknown> = { field: field.field, type: field.type };
            if (field.conflict) {
              entry.type = 'conflict';
              entry.conflict = field.conflict;
            }
            return entry;
          }),
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/fields/stats',
    auth: 'any',
    resource: streamFromQuery,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    rate: 'search',
    body: 'none',
    handler: async (ctx) => {
      const field = ctx.url.searchParams.get('field') ?? '';
      const { outcome } = await matchForRequest(ctx);
      const conflict = outcome.context.conflictOf(field);
      if (conflict) throw fail.fieldConflict(conflict);
      return { status: 200, body: fieldStatistics(outcome.hits, field) };
    },
  });

  route({
    method: 'GET',
    path: '/api/suggest',
    auth: 'any',
    resource: streamFromQuery,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    rate: 'search',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      const { fromMs, toMs } = rangeOf(ctx);
      const { context, generations } = await streamContext(stream, fromMs, toMs);
      const byName = new Map(context.fields.map((field) => [field.field, field]));
      const target = suggestTarget(
        ctx.url.searchParams.get('q') ?? '',
        Number(ctx.url.searchParams.get('cursor') ?? '0'),
        (name) => byName.has(name),
      );
      if (target.kind === 'none') return { status: 200, body: { kind: 'none', items: [] } };
      if (target.kind === 'field') {
        const items = context.fields
          .filter((field) => field.field.startsWith(target.typed))
          .slice(0, 10)
          .map((field) => ({ label: field.field, insert: field.field }));
        return { status: 200, body: { kind: 'field', items } };
      }
      if (target.kind === 'operator') {
        const type = byName.get(target.field)?.type ?? 'keyword';
        return { status: 200, body: { kind: 'operator', items: operatorItems(type, target.typed) } };
      }
      const type = byName.get(target.field)?.type ?? 'keyword';
      const load = await loadRange(stream, fromMs, toMs, generations);
      const counts = new Map<string, number>();
      for (const event of load.events) {
        const values = valuesOf(event.fields[target.field]);
        if (values.length === 0) continue;
        const seen = new Set<string>();
        for (const value of values) {
          if (type === 'text' && typeof value === 'string') {
            for (const token of analyze('standard', value)) seen.add(token.token);
            continue;
          }
          seen.add(String(value));
        }
        for (const value of seen) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const typed = target.typed.toLowerCase();
      const items = [...counts.entries()]
        .filter(([value]) => value.toLowerCase().startsWith(typed))
        .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
        .slice(0, 10)
        .map(([value, count]) => ({ label: value, insert: valueInsert(value), count }));
      return { status: 200, body: { kind: 'value', items } };
    },
  });

  route({
    method: 'POST',
    path: '/api/analyze',
    auth: 'any',
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'json',
    handler: async (ctx) => {
      const analyzer = String(ctx.body.analyzer ?? '') as AnalyzerName;
      const text = ctx.body.text;
      if (!['standard', 'keyword', 'whitespace'].includes(analyzer)) {
        throw fail.invalid({ analyzer: 'Choose standard, keyword or whitespace.' });
      }
      if (typeof text !== 'string') throw fail.invalid({ text: 'Enter some text.' });
      return { status: 200, body: { tokens: analyze(analyzer, text) } };
    },
  });

  route({
    method: 'POST',
    path: '/api/snapshots',
    auth: 'any',
    space: true,
    role: 'viewer',
    keyAction: 'read',
    rate: 'search',
    body: 'json',
    handler: async (ctx) => {
      const streamName = String(ctx.body.stream ?? '');
      const stream = await streamByName(ctx.space.id, streamName);
      if (!stream) throw fail.notFound();
      const fromMs = Date.parse(String(ctx.body.from));
      const toMs = Date.parse(String(ctx.body.to));
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
        throw fail.invalid({ from: 'Enter a time as YYYY-MM-DD HH:MM:SS.' });
      }
      const filters = Array.isArray(ctx.body.filters) ? (ctx.body.filters as Filter[]) : [];
      const q = String(ctx.body.q ?? '');
      const sort = ctx.body.sort === undefined || ctx.body.sort === null ? null : String(ctx.body.sort);
      const outcome = await runMatch({
        stream,
        q,
        fromMs,
        toMs,
        filters,
        sort,
        nowMs: nowMs(),
      });
      const id = randomUUID();
      const events = outcome.hits.map((hit) => serializeEvent(hit, false));
      await query(
        `insert into snapshots (id, space_id, stream_name, params, events, total, partial, skipped_generations, created_ms, last_used_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          id,
          ctx.space.id,
          stream.name,
          JSON.stringify({ q, from: fromMs, to: toMs, filters, sort }),
          JSON.stringify(events),
          outcome.total,
          outcome.partial,
          outcome.skippedGenerations,
          nowMs(),
        ],
      );
      return {
        status: 201,
        body: {
          id,
          total: outcome.total,
          partial: outcome.partial,
          skipped_generations: outcome.skippedGenerations,
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/snapshots/:id',
    auth: 'any',
    resource: snapshotResource,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const row = await one(`select * from snapshots where id = $1 and space_id = $2`, [
        ctx.params.id,
        ctx.space.id,
      ]);
      if (!row) throw fail.notFound();
      const lastUsed = Number(row.last_used_ms);
      if (nowMs() >= lastUsed + settings.snapshotTtlMs) {
        await query(`delete from snapshots where id = $1`, [ctx.params.id]);
        throw fail.snapshotExpired();
      }
      const events = row.events as Record<string, unknown>[];
      const after = Number(ctx.url.searchParams.get('after') ?? '0');
      const cursor = Number.isInteger(after) && after > 0 ? after : 0;
      const page = events.slice(cursor, cursor + settings.pageSize);
      const next = cursor + settings.pageSize < events.length ? String(cursor + settings.pageSize) : null;
      await query(`update snapshots set last_used_ms = $2 where id = $1`, [ctx.params.id, nowMs()]);
      const params = row.params as {
        q: string;
        from: number;
        to: number;
        filters: Filter[];
        sort: string | null;
      };
      const stream = await streamByName(ctx.space.id, String(row.stream_name));
      let newEvents = 0;
      if (stream) {
        const fresh = await runMatch({
          stream,
          q: params.q,
          fromMs: params.from,
          toMs: params.to,
          filters: params.filters,
          sort: params.sort,
          nowMs: nowMs(),
        });
        const frozen = new Set(events.map((event) => String(event._id)));
        newEvents = fresh.hits.filter((hit) => !frozen.has(hit.event.eventId)).length;
      }
      return {
        status: 200,
        body: {
          events: page,
          next,
          total: Number(row.total),
          new_events: newEvents,
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/tail',
    auth: 'any',
    resource: streamFromQuery,
    space: true,
    role: 'viewer',
    keyAction: 'read',
    body: 'none',
    handler: async (ctx) => {
      const stream = streamOf(ctx);
      subscribeTail(stream.id, stream.name, ctx.res);
      return { status: 200, handled: true };
    },
  });

  route({
    method: 'POST',
    path: '/api/pipe',
    auth: 'any',
    space: true,
    role: 'viewer',
    keyAction: 'read',
    rate: 'search',
    body: 'json',
    handler: async (ctx) => {
      const text = String(ctx.body.pipe ?? '');
      const result = await runPipe({
        text,
        zone: ctx.zone,
        nowMs: nowMs(),
        resolveStream: async (name) => {
          const stream = await streamByName(ctx.space.id, name);
          if (!stream) return null;
          if (ctx.caller.kind === 'key') return stream;
          return stream;
        },
      });
      return { status: 200, body: result };
    },
  });
}

