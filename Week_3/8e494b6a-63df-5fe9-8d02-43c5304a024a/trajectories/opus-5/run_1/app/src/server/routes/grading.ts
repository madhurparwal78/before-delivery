import { randomUUID } from 'node:crypto';
import { advanceClock, nowIso, nowMs, setClock } from '../clock.js';
import { createSession, resetRateWindows } from '../auth.js';
import { one, query } from '../db.js';
import { rates, settings } from '../env.js';
import { fail } from '../errors.js';
import { route, sessionCookie } from '../http.js';
import { currentSeq, publish } from '../live.js';
import { setStorageDown } from '../storage.js';
import {
  createGeneration,
  generationsOf,
  listStreams,
  spaceTotals,
  streamByName,
  type GenerationRow,
  type StreamRow,
} from '../store.js';
import {
  ensureExplicitMapping,
  ensureKey,
  ensureMember,
  ensurePipeline,
  ensureSpace,
  ensureStream,
  ensureUser,
  seedEvent,
  type SeedEvent,
} from '../seed.js';
import {
  groupsOf,
  maintenanceOf,
  rulesOf,
  ruleRowOf,
  runRuleCheck,
  snoozedAt,
  sortDays,
  windowCovers,
  type RuleSpec,
} from '../domain/alerts.js';
import { lifecycleStep, serializeGeneration } from '../domain/lifecycle.js';
import { segmentKey, putObject, isStorageDown } from '../storage.js';
import { serializeSegmentEvent, loadRange } from '../store.js';
import { serializeGroup } from './alerts.js';
import type { FieldType } from '../domain/mapping.js';
import type { Processor } from '../domain/pipeline.js';
import type { SpanInput } from '../domain/trace.js';

type SeedBody = {
  users?: { username: string; password: string; time_zone?: string }[];
  spaces?: { slug: string; name: string; members?: { username: string; role: string }[] }[];
  keys?: {
    space: string;
    name: string;
    stream_pattern: string;
    actions: string[];
    expires_in_days?: number | null;
  }[];
  streams?: {
    space: string;
    name: string;
    mappings?: Record<string, FieldType>;
    lifecycle?: Record<string, number | null>;
    generations?: {
      number: number;
      phase: string;
      created_at?: string;
      rolled_over_at?: string | null;
      events?: SeedEvent[];
    }[];
  }[];
  pipelines?: { space: string; name: string; processors: Processor[] }[];
  saved_searches?: {
    space: string;
    name: string;
    stream: string;
    q?: string;
    filters?: unknown[];
    from: string;
    to: string;
  }[];
  rules?: ({
    space: string;
    name: string;
    groups?: {
      group: string;
      state: string;
      since?: string;
      history?: { at: string; from: string; to: string }[];
    }[];
  } & RuleSpec)[];
  maintenance?: {
    space: string;
    name: string;
    time_zone: string;
    days: string[];
    start: string;
    duration_ms: number;
    rule: string;
  }[];
  cases?: { space: string; title: string; status?: string }[];
  traces?: { space: string; trace_id: string; spans: SpanInput[] }[];
  objectives?: {
    space: string;
    service: string;
    name: string;
    stream: string;
    target: number;
    objective_window_ms?: number;
    bad: { field: string; op: string; value: unknown };
    counts?: unknown;
  }[];
  rates?: { upload?: number; login?: number; search?: number; tail?: number };
};

async function spaceIdOf(slug: string): Promise<number> {
  const row = await one<{ id: number }>(`select id from spaces where slug = $1`, [slug]);
  if (!row) throw fail.invalid({ space: `Unknown space ${slug}.` });
  return Number(row.id);
}

export function registerGradingRoutes(): void {
  const guard = (): void => {
    if (!settings.grading) throw fail.notFound();
  };

  route({
    method: 'POST',
    path: '/api/grading/seed',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      guard();
      const body = ctx.body as SeedBody;
      const reply: Record<string, unknown> = {};

      if (body.rates) {
        if (body.rates.upload !== undefined) rates.upload = body.rates.upload;
        if (body.rates.login !== undefined) rates.login = body.rates.login;
        if (body.rates.search !== undefined) rates.search = body.rates.search;
        if (body.rates.tail !== undefined) rates.tail = body.rates.tail;
        resetRateWindows();
      }

      if (body.users) {
        const users = [];
        for (const user of body.users) {
          const existing = await one(`select id from users where username = $1`, [user.username]);
          if (existing) throw fail.nameTaken({ username: 'That username is taken.' });
          const id = await ensureUser(user.username, user.password, user.time_zone ?? 'UTC');
          users.push({ username: user.username, id });
        }
        reply.users = users;
      }

      if (body.spaces) {
        const spaces = [];
        for (const space of body.spaces) {
          const existing = await one(`select id from spaces where slug = $1`, [space.slug]);
          if (existing) throw fail.nameTaken({ slug: 'That name is already used.' });
          const id = await ensureSpace(space.slug, space.name);
          for (const member of space.members ?? []) {
            const user = await one<{ id: number }>(`select id from users where username = $1`, [
              member.username,
            ]);
            if (!user) throw fail.invalid({ members: `Unknown user ${member.username}.` });
            await ensureMember(id, Number(user.id), member.role);
            await query(`update users set current_space_id = coalesce(current_space_id, $2) where id = $1`, [
              Number(user.id),
              id,
            ]);
          }
          spaces.push({ slug: space.slug, id });
        }
        reply.spaces = spaces;
      }

      if (body.keys) {
        const keys = [];
        for (const key of body.keys) {
          const spaceId = await spaceIdOf(key.space);
          const value = `spk_${randomUUID().replace(/-/g, '')}`;
          const expiresMs =
            key.expires_in_days === null || key.expires_in_days === undefined
              ? null
              : nowMs() + key.expires_in_days * 86400000;
          const id = await ensureKey({
            spaceId,
            name: key.name,
            value,
            pattern: key.stream_pattern,
            actions: key.actions,
            expiresMs,
          });
          keys.push({ name: key.name, id, key: value });
        }
        reply.keys = keys;
      }

      if (body.pipelines) {
        const pipelines = [];
        for (const pipeline of body.pipelines) {
          const spaceId = await spaceIdOf(pipeline.space);
          await ensurePipeline(spaceId, pipeline.name, pipeline.processors);
          const row = await one<{ id: number; version: number }>(
            `select id, version from pipelines where space_id = $1 and name = $2`,
            [spaceId, pipeline.name],
          );
          pipelines.push({ name: pipeline.name, id: Number(row?.id), version: Number(row?.version) });
        }
        reply.pipelines = pipelines;
      }

      if (body.streams) {
        const streams = [];
        for (const streamSeed of body.streams) {
          const spaceId = await spaceIdOf(streamSeed.space);
          const space = await one<{ slug: string }>(`select slug from spaces where id = $1`, [spaceId]);
          const existing = await streamByName(spaceId, streamSeed.name);
          if (existing) throw fail.nameTaken({ name: 'That name is already used.' });
          const stream = await ensureStream(spaceId, streamSeed.name);
          if (streamSeed.lifecycle) {
            await query(
              `update streams set rollover_max_age_ms = $2, rollover_max_events = $3,
                 warm_after_ms = $4, archive_after_ms = $5, delete_after_ms = $6 where id = $1`,
              [
                stream.id,
                streamSeed.lifecycle.rollover_max_age_ms ?? null,
                streamSeed.lifecycle.rollover_max_events ?? null,
                streamSeed.lifecycle.warm_after_ms ?? null,
                streamSeed.lifecycle.archive_after_ms ?? null,
                streamSeed.lifecycle.delete_after_ms ?? null,
              ],
            );
          }
          const seeds = [...(streamSeed.generations ?? [])].sort((left, right) => left.number - right.number);
          const highest = seeds.length > 0 ? seeds[seeds.length - 1] : null;
          if (highest && highest.phase !== 'hot') {
            throw fail.invalid({ generations: 'The highest-numbered generation must be hot.' });
          }
          const generations: GenerationRow[] = [];
          for (const seed of seeds) {
            const createdMs = seed.created_at ? Date.parse(seed.created_at) : nowMs();
            const generation = await createGeneration(stream.id, seed.number, 'hot', createdMs);
            await query(`update generations set became_write_ms = $2, rolled_over_ms = $3 where id = $1`, [
              generation.id,
              createdMs,
              seed.rolled_over_at ? Date.parse(seed.rolled_over_at) : null,
            ]);
            for (const [field, type] of Object.entries(streamSeed.mappings ?? {})) {
              await ensureExplicitMapping(generation.id, field, type);
            }
            for (const event of seed.events ?? []) {
              const outcome = await seedEvent(spaceId, stream, generation, event);
              if (!outcome.ok) throw fail.invalid({ events: `${outcome.reason}.` });
            }
            generations.push(generation);
          }
          await query(`update streams set write_generation = $2 where id = $1`, [
            stream.id,
            highest ? highest.number : 1,
          ]);
          const refreshed = await generationsOf(stream.id);
          for (const seed of seeds) {
            if (seed.phase === 'hot') continue;
            const generation = refreshed.find((item) => item.number === seed.number)!;
            if (seed.phase === 'warm') {
              await query(
                `update generations set phase = 'warm', rolled_over_ms = coalesce(rolled_over_ms, created_ms) where id = $1`,
                [generation.id],
              );
              continue;
            }
            if (seed.phase === 'archive') {
              const load = await loadRange(stream, 0, 8640000000000000, [generation]);
              const rows = load.events
                .filter((event) => event.generation === generation.number)
                .sort((left, right) =>
                  left.tsMs !== right.tsMs
                    ? left.tsMs - right.tsMs
                    : left.eventId < right.eventId
                      ? -1
                      : 1,
                );
              const buffer = Buffer.from(
                rows.map((event) => `${serializeSegmentEvent(event)}\n`).join(''),
                'utf8',
              );
              const key = segmentKey(String(space?.slug), stream.name, generation.number);
              try {
                const bytes = await putObject(key, buffer);
                await query(`delete from postings where generation_id = $1`, [generation.id]);
                await query(
                  `delete from doc_lengths where event_row in (select id from events where generation_id = $1)`,
                  [generation.id],
                );
                await query(`delete from events where generation_id = $1`, [generation.id]);
                await query(
                  `update generations set phase = 'archive', segment_key = $2, segment_bytes = $3,
                     rolled_over_ms = coalesce(rolled_over_ms, created_ms) where id = $1`,
                  [generation.id, key, bytes],
                );
              } catch (cause) {
                if (isStorageDown(cause)) throw fail.storageUnavailable();
                throw cause;
              }
            }
          }
          const finalGenerations = await generationsOf(stream.id);
          streams.push({
            space: streamSeed.space,
            name: streamSeed.name,
            id: stream.id,
            generations: finalGenerations.map((generation) => ({
              number: generation.number,
              id: generation.id,
              phase: generation.phase,
            })),
          });
        }
        reply.streams = streams;
      }

      if (body.saved_searches) {
        const searches = [];
        for (const search of body.saved_searches) {
          const spaceId = await spaceIdOf(search.space);
          const id = randomUUID();
          await query(
            `insert into saved_searches (id, space_id, name, stream_name, q, filters, from_iso, to_iso)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              spaceId,
              search.name,
              search.stream,
              search.q ?? '',
              JSON.stringify(search.filters ?? []),
              search.from,
              search.to,
            ],
          );
          searches.push({ name: search.name, id });
        }
        reply.saved_searches = searches;
      }

      if (body.rules) {
        const rules = [];
        for (const ruleSeed of body.rules) {
          const spaceId = await spaceIdOf(ruleSeed.space);
          const existing = await one(`select 1 from rules where space_id = $1 and name = $2`, [
            spaceId,
            ruleSeed.name,
          ]);
          if (existing) throw fail.nameTaken({ name: 'That name is already used.' });
          const id = randomUUID();
          const spec: RuleSpec = {
            stream: ruleSeed.stream,
            filter: ruleSeed.filter ?? null,
            measure: ruleSeed.measure,
            measure_field: ruleSeed.measure_field ?? null,
            group_by: ruleSeed.group_by ?? null,
            window_ms: ruleSeed.window_ms,
            comparison: ruleSeed.comparison,
            threshold: ruleSeed.threshold,
            frequency: ruleSeed.frequency ?? { kind: 'change' },
          };
          await query(`insert into rules (id, space_id, name, spec) values ($1, $2, $3, $4)`, [
            id,
            spaceId,
            ruleSeed.name,
            JSON.stringify(spec),
          ]);
          for (const group of ruleSeed.groups ?? []) {
            const sinceMs = group.since ? Date.parse(group.since) : nowMs();
            const boundary =
              group.state === 'active' || group.state === 'recovered' ? sinceMs : null;
            await query(
              `insert into rule_groups (rule_id, group_name, state, since_ms, boundary_ms) values ($1, $2, $3, $4, $5)`,
              [id, group.group, group.state, sinceMs, boundary],
            );
            let checkNumber = 0;
            for (const entry of group.history ?? []) {
              checkNumber += 1;
              await query(
                `insert into rule_history (rule_id, group_name, check_no, at_ms, from_state, to_state)
                 values ($1, $2, $3, $4, $5, $6)`,
                [id, group.group, checkNumber, Date.parse(entry.at), entry.from, entry.to],
              );
            }
            if (checkNumber > 0) {
              await query(`update rules set checks = greatest(checks, $2) where id = $1`, [id, checkNumber]);
            }
          }
          rules.push({ name: ruleSeed.name, id });
        }
        reply.rules = rules;
      }

      if (body.maintenance) {
        const windows = [];
        for (const window of body.maintenance) {
          const spaceId = await spaceIdOf(window.space);
          const rule = await one<{ id: string }>(
            `select id from rules where space_id = $1 and (name = $2 or id = $2)`,
            [spaceId, window.rule],
          );
          if (!rule) throw fail.invalid({ rule: `Unknown rule ${window.rule}.` });
          const id = randomUUID();
          await query(
            `insert into maintenance (id, space_id, name, time_zone, days, start, duration_ms, rule_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              spaceId,
              window.name,
              window.time_zone,
              JSON.stringify(sortDays(window.days)),
              window.start,
              window.duration_ms,
              String(rule.id),
            ],
          );
          windows.push({ name: window.name, id });
        }
        reply.maintenance = windows;
      }

      if (body.cases) {
        const cases = [];
        for (const item of body.cases) {
          const spaceId = await spaceIdOf(item.space);
          const created = await one<{ id: number; number: number }>(
            `insert into cases (space_id, number, title, status, created_ms)
             values ($1, (select coalesce(max(number), 0) + 1 from cases where space_id = $1), $2, $3, $4)
             returning id, number`,
            [spaceId, item.title, item.status ?? 'open', nowMs()],
          );
          cases.push({ number: Number(created?.number), id: Number(created?.id) });
        }
        reply.cases = cases;
      }

      if (body.traces) {
        const traces = [];
        for (const trace of body.traces) {
          const spaceId = await spaceIdOf(trace.space);
          await query(`insert into traces (space_id, trace_id, spans, at_ms) values ($1, $2, $3, $4)`, [
            spaceId,
            trace.trace_id,
            JSON.stringify(trace.spans),
            nowMs(),
          ]);
          traces.push({ trace_id: trace.trace_id });
        }
        reply.traces = traces;
      }

      if (body.objectives) {
        const objectives = [];
        for (const objective of body.objectives) {
          const spaceId = await spaceIdOf(objective.space);
          const id = randomUUID();
          await query(
            `insert into objectives (id, space_id, service, name, stream_name, target, objective_window_ms, bad, counts)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              id,
              spaceId,
              objective.service,
              objective.name,
              objective.stream,
              objective.target,
              objective.objective_window_ms ?? 2592000000,
              JSON.stringify(objective.bad),
              objective.counts === undefined ? null : JSON.stringify(objective.counts),
            ],
          );
          objectives.push({ name: objective.name, id });
        }
        reply.objectives = objectives;
      }

      const anySpace = await one<{ id: number }>(`select id from spaces order by id asc limit 1`);
      reply.seq = anySpace ? await currentSeq(Number(anySpace.id)) : 0;
      return { status: 201, body: reply };
    },
  });

  route({
    method: 'POST',
    path: '/api/grading/session',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      guard();
      const username = String(ctx.body.username ?? '').toLowerCase();
      const user = await one<{ id: number }>(`select id from users where username = $1`, [username]);
      if (!user) throw fail.notFound();
      const sessionId = await createSession(Number(user.id));
      ctx.setCookie = sessionCookie(sessionId);
      return { status: 200, body: { username } };
    },
  });

  route({
    method: 'POST',
    path: '/api/grading/clock',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      guard();
      if (ctx.body.set_ms !== undefined) setClock(Number(ctx.body.set_ms));
      else if (ctx.body.advance_ms !== undefined) advanceClock(Number(ctx.body.advance_ms));
      const spaces = await query<{ id: number }>(`select id from spaces`);
      for (const space of spaces) {
        const spaceId = Number(space.id);
        await publish(spaceId, 'clock', { now: nowIso(), now_ms: nowMs() });
        const windows = await maintenanceOf(spaceId);
        for (const rule of await rulesOf(spaceId)) {
          const ruleWindows = windows.filter((window) => window.ruleId === rule.id);
          const inMaintenance = ruleWindows.some((window) => windowCovers(window, nowMs()));
          for (const group of await groupsOf(rule.id)) {
            const overlay = inMaintenance || snoozedAt(group, nowMs());
            if (!overlay && !group.flapping) continue;
            await publish(spaceId, 'alert', {
              rule: rule.id,
              rule_name: rule.name,
              group: group.group,
              ...serializeGroup(group, inMaintenance),
            });
          }
        }
      }
      return { status: 200, body: { now: nowIso(), now_ms: nowMs() } };
    },
  });

  route({
    method: 'POST',
    path: '/api/grading/check',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      guard();
      const ruleId = String(ctx.body.rule ?? '');
      const row = await one(`select * from rules where id = $1`, [ruleId]);
      if (!row) throw fail.notFound();
      const rule = ruleRowOf(row);
      const result = await runRuleCheck(rule.spaceId, rule, { fail: ctx.body.fail === true });
      const windows = (await maintenanceOf(rule.spaceId)).filter((window) => window.ruleId === rule.id);
      const inMaintenance = windows.some((window) => windowCovers(window, nowMs()));
      for (const group of await groupsOf(rule.id)) {
        const checked = result.groups.find((item) => item.group === group.group);
        await publish(rule.spaceId, 'alert', {
          rule: rule.id,
          rule_name: rule.name,
          group: group.group,
          changed: checked?.changed ?? false,
          last_check: { at: new Date(result.checkedAtMs).toISOString(), failed: result.failed },
          ...serializeGroup(group, inMaintenance),
        });
      }
      for (const item of result.inboxItems) {
        await publish(rule.spaceId, 'inbox', {
          item: {
            id: item.id,
            rule: rule.id,
            group: item.group,
            text: item.text,
            at: new Date(item.atMs).toISOString(),
            acknowledged_by: null,
          },
        });
      }
      return {
        status: 200,
        body: {
          rule: rule.id,
          checked_at: new Date(result.checkedAtMs).toISOString(),
          failed: result.failed,
          groups: result.groups.map((group) => ({
            group: group.group,
            state: group.state,
            value: group.value,
            flapping: group.flapping,
            snoozed: group.snoozed,
            in_maintenance: group.in_maintenance,
            action: group.action,
          })),
          seq: await currentSeq(rule.spaceId),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/grading/lifecycle',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      guard();
      const slug = String(ctx.body.space ?? '');
      const spaceId = await spaceIdOf(slug);
      const name = String(ctx.body.stream ?? '');
      const stream = await streamByName(spaceId, name);
      if (!stream) throw fail.notFound();
      await lifecycleStep(slug, stream);
      const refreshed = (await streamByName(spaceId, name)) as StreamRow;
      const generations = await generationsOf(refreshed.id);
      const totals = await spaceTotals(spaceId);
      const payload = generations.map((generation) =>
        serializeGeneration(refreshed, generation, 'UTC'),
      );
      const seq = await publish(spaceId, 'lifecycle', {
        stream: name,
        generations: payload,
        stored_total: totals.stored,
        failure_total: totals.failed,
      });
      return { status: 200, body: { stream: name, generations: payload, seq } };
    },
  });

  route({
    method: 'POST',
    path: '/api/grading/storage',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      guard();
      const down = ctx.body.down === true;
      setStorageDown(down);
      return { status: 200, body: { storage: down ? 'down' : 'up' } };
    },
  });
}

export async function runEveryLifecycleStep(): Promise<void> {
  const spaces = await query<{ id: number; slug: string }>(`select id, slug from spaces`);
  for (const space of spaces) {
    for (const stream of await listStreams(Number(space.id))) {
      await lifecycleStep(String(space.slug), stream);
    }
  }
}

export async function runEveryRuleCheck(): Promise<void> {
  const spaces = await query<{ id: number }>(`select id from spaces`);
  for (const space of spaces) {
    for (const rule of await rulesOf(Number(space.id))) {
      await runRuleCheck(Number(space.id), rule);
    }
  }
}
