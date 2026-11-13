/**
 * Grading routes, only with SPOOR_GRADING=1. Otherwise every one answers 404.
 */
import type { Request, Response, Router } from "express";
import type { PoolClient } from "pg";
import { config, setRateOverride } from "./config";
import { nowIso, nowMs, setClock } from "./clock";
import { ApiError, errors } from "./errors";
import { nextId, withDb } from "./db";
import {
  type StreamRow,
  checkAndInfer,
  fieldConflicts,
  insertEvent,
  listGenerations,
  streamEventCount,
  writeGenerationRow,
  generationMapping,
} from "./events";
import { loadContext } from "./context";
import { broadcastToSpace, nextSeq } from "./bus";
import { lifecycleStep } from "./lifecycle";
import { runCheck, isSnoozed, listGroups } from "./alerts";
import { putObject, confirmObjectSize, segmentKey, setStorageDown } from "./storage";
import { validateTrace, type SpanInput } from "./traces";
import { flatten } from "../shared/util";

interface SeedUser {
  username: string;
  password: string;
  time_zone?: string;
}
interface SeedSpace {
  slug: string;
  name: string;
  members: { username: string; role: string }[];
}
interface SeedKey {
  space: string;
  name: string;
  stream_pattern: string;
  actions: string[];
  expires_in_days?: number | null;
}
interface SeedStream {
  space: string;
  name: string;
  mappings?: Record<string, string>;
  lifecycle?: Record<string, number | null>;
  generations: {
    number: number;
    phase: string;
    created_at: string;
    rolled_over_at?: string | null;
    events: {
      _id: string;
      "@timestamp": string;
      [field: string]: unknown;
    }[];
  }[];
}
interface SeedPipeline {
  space: string;
  name: string;
  processors: unknown[];
}
interface SeedSavedSearch {
  space: string;
  name: string;
  stream: string;
  q: string;
  filters: unknown[];
  from: string;
  to: string;
}
interface SeedRule {
  space: string;
  name: string;
  stream: string;
  filter: { field: string; op: string; value: unknown } | null;
  measure: string;
  measure_field: string | null;
  group_by: string | null;
  window_ms: number;
  comparison: string;
  threshold: number;
  frequency: Record<string, unknown>;
  groups: {
    group: string;
    state: string;
    since: string;
    history: { at: string; from: string; to: string }[];
  }[];
}
interface SeedMaintenance {
  space: string;
  name: string;
  time_zone: string;
  days: string[];
  start: string;
  duration_ms: number;
  rule: string;
}
interface SeedCase {
  space: string;
  title: string;
  status: string;
}
interface SeedTrace {
  space: string;
  trace_id: string;
  spans: SpanInput[];
}
interface SeedObjective {
  space: string;
  service: string;
  name: string;
  stream: string;
  target: number;
  objective_window_ms: number;
  bad: Record<string, unknown>;
  counts?: {
    objective: { bad: number; total: number };
    long: { bad: number; total: number };
    short: { bad: number; total: number };
  };
}
interface SeedRates {
  upload?: number;
  login?: number;
  search?: number;
  tail?: number;
}

export function gradingRoutes(router: Router): void {
  router.post("/api/grading/seed", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const out = {
      users: [] as { username: string; id: string }[],
      spaces: [] as { slug: string; id: string }[],
      keys: [] as { name: string; id: string; key: string }[],
      streams: [] as unknown[],
      pipelines: [] as { name: string; id: string; version: number }[],
      saved_searches: [] as { name: string; id: string }[],
      rules: [] as { name: string; id: string }[],
      maintenance: [] as { name: string; id: string }[],
      cases: [] as { number: number; id: string }[],
      traces: [] as { trace_id: string }[],
      objectives: [] as { name: string; id: string }[],
      seq: 0,
    };
    await withDb(async (db) => {
      await db.query("BEGIN");
      try {
        // users
        const users = (body.users as SeedUser[] | undefined) ?? [];
        for (const u of users) {
          if (typeof u.username !== "string" || typeof u.password !== "string") {
            throw errors.invalid({ users: "Check the highlighted fields." });
          }
          const existing = await db.query("SELECT id FROM users WHERE username = $1", [u.username]);
          if (existing.rows.length > 0) {
            throw errors.nameTaken();
          }
          const id = nextId();
          const { hashPassword } = await import("./auth.js");
          const hash = await hashPassword(u.password);
          await db.query(
            "INSERT INTO users (id, username, password_hash, time_zone, current_space, created_at) VALUES ($1,$2,$3,$4,$5,now())",
            [id, u.username, hash, u.time_zone ?? "UTC", u.username],
          );
          out.users.push({ username: u.username, id });
        }
        // spaces
        const spaces = (body.spaces as SeedSpace[] | undefined) ?? [];
        const spaceIdBySlug = new Map<string, string>();
        for (const sp of spaces) {
          const existing = await db.query("SELECT id FROM spaces WHERE slug = $1", [sp.slug]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          const id = nextId();
          spaceIdBySlug.set(sp.slug, id);
          await db.query("INSERT INTO spaces (id, slug, name, seq, created_at) VALUES ($1,$2,$3,0,now())", [
            id,
            sp.slug,
            sp.name,
          ]);
          out.spaces.push({ slug: sp.slug, id });
          for (const m of sp.members ?? []) {
            const user = await db.query("SELECT id FROM users WHERE username = $1", [m.username]);
            if (user.rows.length === 0) throw errors.invalid({ spaces: "Check the highlighted fields." });
            await db.query("INSERT INTO members (space_id, user_id, role) VALUES ($1,$2,$3)", [
              id,
              user.rows[0].id,
              m.role,
            ]);
          }
        }
        // keys
        const keys = (body.keys as SeedKey[] | undefined) ?? [];
        for (const k of keys) {
          const spaceId = spaceIdBySlug.get(k.space);
          if (!spaceId) throw errors.invalid({ keys: "Check the highlighted fields." });
          const existing = await db.query("SELECT 1 FROM api_keys WHERE space_id = $1 AND name = $2", [
            spaceId,
            k.name,
          ]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          const { newKey, sha256 } = await import("./auth.js");
          const key = newKey();
          const id = nextId();
          const days = k.expires_in_days ?? null;
          await db.query(
            `INSERT INTO api_keys (id, space_id, name, stream_pattern, actions, key_hash, last4, expires_at, revoked, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,now())`,
            [
              id,
              spaceId,
              k.name,
              k.stream_pattern,
              k.actions.join(","),
              sha256(key),
              key.slice(-4),
              days ? new Date(nowMs() + days * 86400000) : null,
            ],
          );
          out.keys.push({ name: k.name, id, key });
        }
        // streams
        const streams = (body.streams as SeedStream[] | undefined) ?? [];
        for (const st of streams) {
          const spaceId = spaceIdBySlug.get(st.space);
          if (!spaceId) throw errors.invalid({ streams: "Check the highlighted fields." });
          const existing = await db.query("SELECT 1 FROM streams WHERE space_id = $1 AND name = $2", [
            spaceId,
            st.name,
          ]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          const streamId = nextId();
          await db.query("INSERT INTO streams (id, space_id, name, created_at) VALUES ($1,$2,$3,now())", [
            streamId,
            spaceId,
            st.name,
          ]);
          if (st.lifecycle) {
            const l = st.lifecycle;
            await db.query(
              `INSERT INTO lifecycle_policy (stream_id, rollover_max_age_ms, rollover_max_events, warm_after_ms, archive_after_ms, delete_after_ms)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                streamId,
                l.rollover_max_age_ms ?? null,
                l.rollover_max_events ?? null,
                l.warm_after_ms ?? null,
                l.archive_after_ms ?? null,
                l.delete_after_ms ?? null,
              ],
            );
          }
          const gensInfo: unknown[] = [];
          const sortedGens = [...st.generations].sort((a, b) => a.number - b.number);
          const highest = sortedGens[sortedGens.length - 1];
          if (!highest || highest.phase !== "hot") {
            throw errors.invalid({ streams: "The highest-numbered generation must be hot." });
          }
          for (const g of sortedGens) {
            const genId = nextId();
            await db.query(
              "INSERT INTO generations (id, stream_id, number, phase, created_at, rolled_over_at, segment_key, segment_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                genId,
                streamId,
                g.number,
                g.phase,
                new Date(g.created_at),
                g.rolled_over_at ? new Date(g.rolled_over_at) : null,
                null,
                null,
              ],
            );
            for (const [field, type] of Object.entries(st.mappings ?? {})) {
              await db.query(
                "INSERT INTO mappings (id, generation_id, field, type, explicit) VALUES ($1,$2,$3,$4,TRUE)",
                [nextId(), genId, field, String(type)],
              );
            }
            for (const e of g.events) {
              const { _id, "@timestamp": ts, ...fields } = e;
              await checkAndInfer(db, genId, fields as Record<string, unknown>);
              await insertEvent(db, genId, {
                id: String(_id),
                ts: new Date(String(ts)),
                fields: fields as Record<string, unknown>,
                pipeline: null,
                seq: 0,
              });
            }
            if (g.phase === "archive") {
              const rows = await db.query<{ event_id: string; ts: Date; fields: Record<string, unknown> }>(
                "SELECT event_id, ts, fields FROM events WHERE generation_id = $1 ORDER BY ts ASC, event_id ASC",
                [genId],
              );
              const lines = rows.rows.map((r) =>
                JSON.stringify({ _id: r.event_id, "@timestamp": r.ts.toISOString(), fields: r.fields }),
              );
              const bytes = Buffer.from(lines.join("\n"), "utf8");
              const key = segmentKey(st.space, st.name, g.number);
              const put = await putObject(key, bytes);
              if (!put.ok) throw errors.storageUnavailable();
              const confirmed = await confirmObjectSize(key, bytes.length);
              if (!confirmed) throw errors.storageUnavailable();
              await db.query("DELETE FROM events WHERE generation_id = $1", [genId]);
              await db.query("DELETE FROM terms WHERE generation_id = $1", [genId]);
              await db.query("UPDATE generations SET segment_key = $1, segment_bytes = $2 WHERE id = $3", [
                key,
                bytes.length,
                genId,
              ]);
            }
            gensInfo.push({ number: g.number, id: genId, phase: g.phase });
          }
          out.streams.push({ space: st.space, name: st.name, id: streamId, generations: gensInfo });
        }
        // pipelines
        const pipelines = (body.pipelines as SeedPipeline[] | undefined) ?? [];
        for (const p of pipelines) {
          const spaceId = spaceIdBySlug.get(p.space);
          if (!spaceId) throw errors.invalid({ pipelines: "Check the highlighted fields." });
          const existing = await db.query("SELECT 1 FROM pipelines WHERE space_id = $1 AND name = $2", [
            spaceId,
            p.name,
          ]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          const id = nextId();
          await db.query("INSERT INTO pipelines (id, space_id, name, version, processors) VALUES ($1,$2,$3,1,$4)", [
            id,
            spaceId,
            p.name,
            JSON.stringify(p.processors ?? []),
          ]);
          out.pipelines.push({ name: p.name, id, version: 1 });
        }
        // saved searches
        const searches = (body.saved_searches as SeedSavedSearch[] | undefined) ?? [];
        for (const s of searches) {
          const spaceId = spaceIdBySlug.get(s.space);
          if (!spaceId) throw errors.invalid({ saved_searches: "Check the highlighted fields." });
          const existing = await db.query("SELECT 1 FROM saved_searches WHERE space_id = $1 AND name = $2", [
            spaceId,
            s.name,
          ]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          const id = nextId();
          await db.query(
            "INSERT INTO saved_searches (id, space_id, name, stream, q, filters, from_ms, to_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [id, spaceId, s.name, s.stream, s.q, JSON.stringify(s.filters ?? []), Date.parse(s.from), Date.parse(s.to)],
          );
          out.saved_searches.push({ name: s.name, id });
        }
        // rules
        const rules = (body.rules as SeedRule[] | undefined) ?? [];
        for (const r of rules) {
          const spaceId = spaceIdBySlug.get(r.space);
          if (!spaceId) throw errors.invalid({ rules: "Check the highlighted fields." });
          const existing = await db.query("SELECT 1 FROM rules WHERE space_id = $1 AND name = $2", [
            spaceId,
            r.name,
          ]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          const stream = await db.query<{ id: string }>(
            "SELECT id FROM streams WHERE space_id = $1 AND name = $2",
            [spaceId, r.stream],
          );
          if (stream.rows.length === 0) throw errors.invalid({ rules: "Check the highlighted fields." });
          const id = nextId();
          await db.query(
            `INSERT INTO rules (id, space_id, name, stream_id, filter, measure, measure_field, group_by, window_ms, comparison, threshold, frequency, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
            [
              id,
              spaceId,
              r.name,
              stream.rows[0].id,
              JSON.stringify(r.filter ?? null),
              r.measure,
              r.measure_field,
              r.group_by,
              r.window_ms,
              r.comparison,
              r.threshold,
              JSON.stringify(r.frequency),
            ],
          );
          for (const g of r.groups ?? []) {
            const history = g.history ?? [];
            await db.query(
              `INSERT INTO rule_groups (id, rule_id, "group", state, since, entered_at, streak, held_action, history, change_log)
               VALUES ($1,$2,$3,$4,$5,$6,0,FALSE,$7,$8)`,
              [
                nextId(),
                id,
                g.group,
                g.state,
                new Date(g.since),
                new Date(g.since),
                JSON.stringify(history),
                JSON.stringify([]),
              ],
            );
          }
          out.rules.push({ name: r.name, id });
        }
        // maintenance
        const maintenance = (body.maintenance as SeedMaintenance[] | undefined) ?? [];
        for (const m of maintenance) {
          const spaceId = spaceIdBySlug.get(m.space);
          if (!spaceId) throw errors.invalid({ maintenance: "Check the highlighted fields." });
          const rule = await db.query<{ id: string }>("SELECT id FROM rules WHERE space_id = $1 AND name = $2", [
            spaceId,
            m.rule,
          ]);
          if (rule.rows.length === 0) throw errors.invalid({ maintenance: "Check the highlighted fields." });
          const id = nextId();
          await db.query(
            "INSERT INTO maintenance (id, space_id, name, time_zone, days, start, duration_ms, rule_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [id, spaceId, m.name, m.time_zone, m.days.join(","), m.start, m.duration_ms, rule.rows[0].id],
          );
          out.maintenance.push({ name: m.name, id });
        }
        // cases
        const cases = (body.cases as SeedCase[] | undefined) ?? [];
        for (const c of cases) {
          const spaceId = spaceIdBySlug.get(c.space);
          if (!spaceId) throw errors.invalid({ cases: "Check the highlighted fields." });
          const max = await db.query<{ n: string }>(
            "SELECT coalesce(max(number), 0)::text AS n FROM cases WHERE space_id = $1",
            [spaceId],
          );
          const number = Number(max.rows[0].n) + 1;
          const id = nextId();
          await db.query(
            "INSERT INTO cases (id, space_id, number, title, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())",
            [id, spaceId, number, c.title, c.status],
          );
          out.cases.push({ number, id });
        }
        // traces
        const traces = (body.traces as SeedTrace[] | undefined) ?? [];
        for (const t of traces) {
          const spaceId = spaceIdBySlug.get(t.space);
          if (!spaceId) throw errors.invalid({ traces: "Check the highlighted fields." });
          const existing = await db.query("SELECT 1 FROM traces WHERE space_id = $1 AND trace_id = $2", [
            spaceId,
            t.trace_id,
          ]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          validateTrace(t.spans ?? [], config().settings.trace_max_spans);
          await db.query("INSERT INTO traces (space_id, trace_id, spans, created_at) VALUES ($1,$2,$3,now())", [
            spaceId,
            t.trace_id,
            JSON.stringify(t.spans ?? []),
          ]);
          out.traces.push({ trace_id: t.trace_id });
        }
        // objectives
        const objectives = (body.objectives as SeedObjective[] | undefined) ?? [];
        for (const o of objectives) {
          const spaceId = spaceIdBySlug.get(o.space);
          if (!spaceId) throw errors.invalid({ objectives: "Check the highlighted fields." });
          const existing = await db.query("SELECT 1 FROM objectives WHERE space_id = $1 AND service = $2", [
            spaceId,
            o.service,
          ]);
          if (existing.rows.length > 0) throw errors.nameTaken();
          const stream = await db.query<{ id: string }>(
            "SELECT id FROM streams WHERE space_id = $1 AND name = $2",
            [spaceId, o.stream],
          );
          if (stream.rows.length === 0) throw errors.invalid({ objectives: "Check the highlighted fields." });
          const id = nextId();
          await db.query(
            `INSERT INTO objectives (id, space_id, service, name, stream_id, target, objective_window_ms, bad, fixed_counts)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              id,
              spaceId,
              o.service,
              o.name,
              stream.rows[0].id,
              o.target,
              o.objective_window_ms,
              JSON.stringify(o.bad),
              o.counts ? JSON.stringify(o.counts) : null,
            ],
          );
          out.objectives.push({ name: o.name, id });
        }
        // rates
        const rates = body.rates as SeedRates | undefined;
        if (rates) {
          if (typeof rates.upload === "number") setRateOverride("upload", rates.upload);
          if (typeof rates.login === "number") setRateOverride("login", rates.login);
          if (typeof rates.search === "number") setRateOverride("search", rates.search);
          if (typeof rates.tail === "number") setRateOverride("tail", rates.tail);
        }
        await db.query("COMMIT");
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
    });
    res.status(201).json(out);
  });

  router.post("/api/grading/session", async (req: Request, res: Response) => {
    const body = req.body as { username?: unknown };
    const username = String(body.username ?? "");
    const user = await withDb(async (db) => {
      const rows = await db.query("SELECT id, username, current_space FROM users WHERE username = $1", [username]);
      return rows.rows[0] ?? null;
    });
    if (!user) throw errors.notFound();
    const { newSessionToken } = await import("./auth.js");
    const token = newSessionToken();
    await withDb(async (db) => {
      await db.query("INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,now())", [token, user.id]);
    });
    res.setHeader("Set-Cookie", `spoor_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    res.status(200).json({ username });
  });

  router.post("/api/grading/clock", async (req: Request, res: Response) => {
    const body = req.body as { set_ms?: unknown; advance_ms?: unknown };
    const result = setClock(
      typeof body.set_ms === "number" ? body.set_ms : undefined,
      typeof body.advance_ms === "number" ? body.advance_ms : undefined,
    );
    // clock message to every space, and alert messages for changed overlays
    const spaces = await withDb(async (db) => db.query("SELECT id FROM spaces"));
    const messages: { spaceId: string; kind: string; data: Record<string, unknown> }[] = [];
    for (const sp of spaces.rows as { id: string }[]) {
      broadcastToSpace(String(sp.id), "clock", { now: result.now, now_ms: result.now_ms }, nextSeq(String(sp.id)));
    }
    await withDb(async (db) => {
      const rules = await db.query("SELECT id, space_id FROM rules");
      for (const r of rules.rows as { id: string; space_id: string }[]) {
        const groups = await listGroups(db, String(r.id));
        for (const g of groups) {
          const before = g.snoozed_until !== null;
          const after = isSnoozed(g, result.now_ms);
          if (before !== after) {
            messages.push({
              spaceId: String(r.space_id),
              kind: "alert",
              data: { rule: String(r.id), group: g.group, snoozed: after },
            });
          }
        }
      }
      for (const m of messages) {
        broadcastToSpace(m.spaceId, "alert", m.data, nextSeq(m.spaceId));
      }
    });
    res.json(result);
  });

  router.post("/api/grading/check", async (req: Request, res: Response) => {
    const body = req.body as { rule?: unknown; fail?: unknown };
    const outcome = await withDb(async (db) => {
      return runCheck(db, String(body.rule ?? ""), body.fail === true, null);
    });
    // live messages for state changes
    await withDb(async (db) => {
      const rule = await db.query("SELECT space_id, name FROM rules WHERE id = $1", [outcome.rule]);
      if (rule.rows[0]) {
        const spaceId = String(rule.rows[0].space_id);
        for (const g of outcome.groups) {
          if (g.changed) {
            const seq = nextSeq(spaceId);
            broadcastToSpace(spaceId, "alert", {
              rule: outcome.rule,
              group: g.group,
              state: g.state,
              text: `${g.group} is ${g.state} on rule ${rule.rows[0].name}`,
            }, seq);
          }
        }
      }
    });
    const seq = nextSeq((await withDb(async (db) => {
      const rule = await db.query<{ space_id: string }>("SELECT space_id FROM rules WHERE id = $1", [outcome.rule]);
      return String(rule.rows[0]?.space_id ?? "0");
    })));
    res.json({
      rule: outcome.rule,
      checked_at: outcome.checked_at,
      failed: outcome.failed,
      groups: outcome.groups.map((g) => ({
        group: g.group,
        state: g.state,
        value: g.value,
        flapping: g.flapping,
        snoozed: g.snoozed,
        in_maintenance: g.in_maintenance,
        action: g.action,
      })),
      seq,
    });
  });

  router.post("/api/grading/lifecycle", async (req: Request, res: Response) => {
    const body = req.body as { stream?: unknown; space?: unknown };
    const spaceSlug = String(body.space ?? "");
    const streamName = String(body.stream ?? "");
    const result = await withDb(async (db) => {
      const ctx = await loadContext(db, req, spaceSlug).catch(() => null);
      const spaceId = ctx?.spaceId ?? (await db.query<{ id: string }>("SELECT id FROM spaces WHERE slug = $1", [spaceSlug])).rows[0]?.id;
      const stream = (await db.query<StreamRow>("SELECT id, space_id, name FROM streams WHERE space_id = $1 AND name = $2", [
        String(spaceId),
        streamName,
      ])).rows[0];
      if (!stream) throw errors.notFound();
      return lifecycleStep(db, spaceSlug, stream);
    });
    const seq = nextSeq((await withDb(async (db) => {
      const rows = await db.query<{ space_id: string }>(
        "SELECT space_id FROM streams WHERE name = $1",
        [streamName],
      );
      const sp = await db.query<{ id: string }>("SELECT id FROM spaces WHERE id = $1", [String(rows.rows[0].space_id)]);
      return String(sp.rows[0]?.id ?? "0");
    })));
    // lifecycle message with the totals
    await withDb(async (db) => {
      const rows = await db.query<{ id: string; space_id: string }>("SELECT id, space_id FROM streams WHERE name = $1", [streamName]);
      if (rows.rows[0]) {
        const stored = await streamEventCount(db, String(rows.rows[0].id));
        const failure = await db.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM failures WHERE stream_id = $1",
          [String(rows.rows[0].id)],
        );
        broadcastToSpace(String(rows.rows[0].space_id), "lifecycle", {
          stream: streamName,
          generations: result.generations,
          stored_total: stored,
          failure_total: Number(failure.rows[0].n),
        }, seq);
      }
    });
    res.json({ stream: streamName, generations: result.generations, seq });
  });

  router.post("/api/grading/storage", async (req: Request, res: Response) => {
    const body = req.body as { down?: unknown };
    setStorageDown(body.down === true);
    const { clearSegmentCache } = await import("./events.js");
    clearSegmentCache();
    res.json({ storage: body.down === true ? "down" : "up" });
  });
}
