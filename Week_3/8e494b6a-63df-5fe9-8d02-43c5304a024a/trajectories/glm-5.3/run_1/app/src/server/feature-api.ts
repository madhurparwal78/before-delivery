/**
 * Pipelines, alerts, inbox, cases, traces, objectives, spaces, keys and saved searches routes.
 */
import type { Request, Response, Router } from "express";
import { config } from "./config";
import { nowMs } from "./clock";
import { ApiError, errors } from "./errors";
import { nextId, withDb } from "./db";
import { requireStream } from "./events";
import { loadContext, needRole, type Ctx } from "./context";
import { broadcastToSpace, nextSeq } from "./bus";
import { validateProcessors, runPipeline, type Processor } from "./pipelines";
import { isValidTimeZone, formatInZone } from "../shared/tz";
import { validateTrace, buildTrace, type SpanInput } from "./traces";
import { objectiveRows, objectiveView } from "./objectives";
import { newKey, sha256 } from "./auth";
import { runCheck, isSnoozed, listGroups, type Frequency, type Measure } from "./alerts";

async function ctxFor(req: Request, spaceParam: string | null): Promise<{ ctx: Ctx; db: import("pg").PoolClient }> {
  return withDb(async (db) => {
    const ctx = await loadContext(db, req, spaceParam);
    if (!ctx) throw errors.notFound();
    return { ctx, db };
  });
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function featureRoutes(router: Router): void {
  // ---------- Pipelines ----------
  router.get("/api/pipelines", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query(
      "SELECT name, version, processors FROM pipelines WHERE space_id = $1 ORDER BY name",
      [ctx.spaceId],
    );
    res.json({ pipelines: rows.rows });
  });

  router.put("/api/pipelines/:name", async (req: Request, res: Response) => {
    const body = req.body as { processors?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "admin");
    const name = req.params.name;
    if (!/^[a-z0-9-]{1,40}$/.test(name)) {
      throw errors.invalid({ name: "Use 1 to 40 characters: a-z, 0-9 or -." });
    }
    const check = validateProcessors(body.processors);
    if (!check.ok) {
      const [k, reason] = check.reason!.replace("Processor ", "").split(": ");
      const idx = Number(k);
      throw errors.invalid({ [`processors[${idx - 1}]`]: `Processor ${idx}: ${reason}.` });
    }
    const existing = await db.query<{ version: number }>(
      "SELECT version FROM pipelines WHERE space_id = $1 AND name = $2",
      [ctx.spaceId, name],
    );
    const seq = nextSeq(ctx.spaceId);
    if (existing.rows.length === 0) {
      await db.query(
        "INSERT INTO pipelines (id, space_id, name, version, processors) VALUES ($1,$2,$3,1,$4)",
        [nextId(), ctx.spaceId, name, JSON.stringify(body.processors)],
      );
      res.status(201).json({
        name,
        version: 1,
        processors: body.processors,
        message: "Pipeline saved. Only new events are affected.",
        seq,
      });
      return;
    }
    const version = existing.rows[0].version + 1;
    await db.query("UPDATE pipelines SET version = $1, processors = $2 WHERE space_id = $3 AND name = $4", [
      version,
      JSON.stringify(body.processors),
      ctx.spaceId,
      name,
    ]);
    res.status(200).json({
      name,
      version,
      processors: body.processors,
      message: "Pipeline saved. Only new events are affected.",
      seq,
    });
  });

  router.post("/api/pipelines/:name/simulate", async (req: Request, res: Response) => {
    const body = req.body as { lines?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const found = await db.query<{ processors: Processor[]; version: number }>(
      "SELECT processors, version FROM pipelines WHERE space_id = $1 AND name = $2",
      [ctx.spaceId, req.params.name],
    );
    if (found.rows.length === 0) throw errors.unknownPipeline(req.params.name);
    const lines = String(body.lines ?? "").split("\n");
    const results = lines.map((line, i) => {
      if (line.trim() === "") return null;
      let event: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { event: i + 1, outcome: "failed", error: `Event ${i + 1}: not valid JSON.`, steps: [] };
        }
        event = parsed as Record<string, unknown>;
      } catch {
        return { event: i + 1, outcome: "failed", error: `Event ${i + 1}: not valid JSON.`, steps: [] };
      }
      const run = runPipeline(req.params.name, found.rows[0].processors, event);
      return {
        event: i + 1,
        outcome: run.outcome,
        error: run.error,
        steps: run.steps.map((s, k) => ({
          step: k + 1,
          processor: found.rows[0].processors[k]?.type ?? "",
          status: s.status,
          event: s.event,
          changed: s.changed,
          text: s.text,
        })),
      };
    });
    res.json({ results: results.filter((r) => r !== null) });
  });

  // ---------- Alerts ----------
  router.get("/api/rules", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query("SELECT * FROM rules WHERE space_id = $1 ORDER BY name", [ctx.spaceId]);
    const rules = [];
    for (const r of rows.rows) {
      const groups = await listGroups(db, String(r.id));
      rules.push({
        ...r,
        groups: groups.map((g) => ({
          group: g.group,
          state: g.state,
          flapping: changeCountPublic(g),
          snoozed: isSnoozed(g, nowMs()),
          snoozed_until: g.snoozed_until ? g.snoozed_until.toISOString() : null,
          in_maintenance: false,
          acknowledged_by: g.acknowledged_by,
        })),
        last_check: r.last_check_at
          ? { at: new Date(r.last_check_at).toISOString(), failed: r.last_check_failed }
          : null,
      });
    }
    res.json({ rules });
  });

  router.get("/api/rules/:id", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query("SELECT * FROM rules WHERE id = $1 AND space_id = $2", [req.params.id, ctx.spaceId]);
    const r = rows.rows[0];
    if (!r) throw errors.notFound();
    const groups = await listGroups(db, String(r.id));
    const history = [];
    for (const g of groups) {
      for (const h of g.history) history.push(h);
    }
    res.json({
      ...r,
      groups: groups.map((g) => ({
        group: g.group,
        state: g.state,
        flapping: changeCountPublic(g),
        snoozed: isSnoozed(g, nowMs()),
        snoozed_until: g.snoozed_until ? g.snoozed_until.toISOString() : null,
        in_maintenance: false,
        acknowledged_by: g.acknowledged_by,
      })),
      last_check: r.last_check_at
        ? { at: new Date(r.last_check_at).toISOString(), failed: r.last_check_failed }
        : null,
      history,
    });
  });

  router.post("/api/rules", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const fields: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name : "";
    if (name === "") fields.name = "Check the highlighted fields.";
    const streamName = String(body.stream ?? "");
    const stream = await requireStream(db, ctx.spaceId, streamName).catch(() => null);
    if (!stream) fields.stream = "Check the highlighted fields.";
    const measure = String(body.measure ?? "");
    if (!["count", "avg", "max", "min", "sum"].includes(measure)) fields.measure = "Check the highlighted fields.";
    if (measure !== "count" && typeof body.measure_field !== "string") {
      fields.measure_field = "Check the highlighted fields.";
    }
    const comparison = String(body.comparison ?? "");
    if (![">", ">=", "<", "<="].includes(comparison)) fields.comparison = "Check the highlighted fields.";
    const windowMs = Number(body.window_ms ?? 0);
    if (!Number.isInteger(windowMs) || windowMs <= 0) fields.window_ms = "Check the highlighted fields.";
    const threshold = Number(body.threshold);
    if (isNaN(threshold)) fields.threshold = "Check the highlighted fields.";
    const freq = body.frequency as { kind?: string; every_ms?: number } | undefined;
    if (!freq || !["change", "check", "throttle"].includes(String(freq.kind))) {
      fields.frequency = "Check the highlighted fields.";
    } else if (freq.kind === "throttle" && (!freq.every_ms || !Number.isInteger(Number(freq.every_ms)))) {
      fields.frequency = "Check the highlighted fields.";
    }
    if (Object.keys(fields).length > 0) throw errors.invalid(fields);
    const existing = await db.query("SELECT 1 FROM rules WHERE space_id = $1 AND name = $2", [ctx.spaceId, name]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    const filter = body.filter ?? null;
    const id = nextId();
    const seq = nextSeq(ctx.spaceId);
    await db.query(
      `INSERT INTO rules (id, space_id, name, stream_id, filter, measure, measure_field, group_by, window_ms, comparison, threshold, frequency, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
      [
        id,
        ctx.spaceId,
        name,
        stream!.id,
        JSON.stringify(filter),
        measure,
        body.measure_field ?? null,
        body.group_by ?? null,
        windowMs,
        comparison,
        threshold,
        JSON.stringify(freq),
      ],
    );
    res.status(201).json({ id, ...body, seq });
  });

  router.post("/api/rules/:id/groups/:group/snooze", async (req: Request, res: Response) => {
    const body = req.body as { for?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const rows = await db.query("SELECT id, space_id FROM rules WHERE id = $1", [req.params.id]);
    if (!rows.rows[0] || String(rows.rows[0].space_id) !== ctx.spaceId) throw errors.notFound();
    const kind = String(body.for ?? "");
    if (!["1h", "1d", "recovered"].includes(kind)) {
      throw errors.invalid({ for: "Check the highlighted fields." });
    }
    const now = nowMs();
    const until = kind === "1h" ? now + 3600000 : kind === "1d" ? now + 86400000 : null;
    await db.query(
      'UPDATE rule_groups SET snoozed_until = $1, snooze_kind = $2 WHERE rule_id = $3 AND "group" = $4',
      [until ? new Date(until) : null, kind, req.params.id, req.params.group],
    );
    const seq = nextSeq(ctx.spaceId);
    broadcastToSpace(ctx.spaceId, "alert", { rule: req.params.id, group: req.params.group, snoozed: true }, seq);
    res.json({ group: req.params.group });
  });

  router.post("/api/rules/:id/groups/:group/ack", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const rows = await db.query("SELECT id, space_id, name FROM rules WHERE id = $1", [req.params.id]);
    if (!rows.rows[0] || String(rows.rows[0].space_id) !== ctx.spaceId) throw errors.notFound();
    const ruleName = String(rows.rows[0].name);
    const ack = await db.query(
      `UPDATE rule_groups SET acknowledged_by = $1 WHERE rule_id = $2 AND "group" = $3 RETURNING acknowledged_by`,
      [ctx.username, req.params.id, req.params.group],
    );
    if (ack.rows.length === 0) throw errors.notFound();
    await db.query(
      `UPDATE inbox SET acknowledged_by = $1 WHERE space_id = $2 AND rule_id = $3 AND "group" = $4 AND acknowledged_by IS NULL`,
      [ctx.username, ctx.spaceId, req.params.id, req.params.group],
    );
    const seq = nextSeq(ctx.spaceId);
    broadcastToSpace(ctx.spaceId, "alert", { rule: req.params.id, group: req.params.group, acknowledged_by: ctx.username }, seq);
    res.json({ group: req.params.group });
  });

  // ---------- Maintenance ----------
  router.get("/api/maintenance", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query(
      "SELECT m.*, r.name AS rule_name FROM maintenance m LEFT JOIN rules r ON r.id = m.rule_id WHERE m.space_id = $1 ORDER BY m.id",
      [ctx.spaceId],
    );
    const { nextWindowStart } = await import("./alerts.js");
    const now = nowMs();
    res.json({
      maintenance: rows.rows.map((r: Record<string, unknown>) => {
        const start = nextWindowStart(
          {
            id: String(r.id),
            space_id: String(r.space_id),
            name: String(r.name),
            time_zone: String(r.time_zone),
            days: String(r.days),
            start: String(r.start),
            duration_ms: Number(r.duration_ms),
            rule_id: String(r.rule_id),
          },
          now,
        );
        return { ...r, next_start: new Date(start).toISOString() };
      }),
    });
  });

  router.post("/api/maintenance", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const fields: Record<string, string> = {};
    const name = String(body.name ?? "");
    if (name === "") fields.name = "Check the highlighted fields.";
    const tz = String(body.time_zone ?? "");
    if (!isValidTimeZone(tz)) fields.time_zone = `Unknown time zone ${tz}.`;
    const days = Array.isArray(body.days) ? (body.days as string[]) : [];
    if (days.some((d) => !DAY_ORDER.includes(d))) fields.days = "Check the highlighted fields.";
    const start = String(body.start ?? "");
    if (!/^\d{2}:\d{2}$/.test(start)) fields.start = "Check the highlighted fields.";
    const duration = Number(body.duration_ms ?? 0);
    if (!Number.isInteger(duration) || duration <= 0) fields.duration_ms = "Check the highlighted fields.";
    const ruleId = String(body.rule ?? "");
    const rule = await db.query("SELECT id FROM rules WHERE id = $1 AND space_id = $2", [ruleId, ctx.spaceId]);
    if (rule.rows.length === 0) fields.rule = "Check the highlighted fields.";
    if (Object.keys(fields).length > 0) throw errors.invalid(fields);
    const id = nextId();
    const seq = nextSeq(ctx.spaceId);
    await db.query(
      "INSERT INTO maintenance (id, space_id, name, time_zone, days, start, duration_ms, rule_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, ctx.spaceId, name, tz, days.join(","), start, duration, ruleId],
    );
    const { nextWindowStart } = await import("./alerts.js");
    const startMs = nextWindowStart(
      { id, space_id: ctx.spaceId, name, time_zone: tz, days: days.join(","), start, duration_ms: duration, rule_id: ruleId },
      nowMs(),
    );
    res.status(201).json({
      id,
      name,
      time_zone: tz,
      days,
      start,
      duration_ms: duration,
      rule: ruleId,
      next_start: new Date(startMs).toISOString(),
      seq,
    });
  });

  // ---------- Inbox ----------
  router.get("/api/inbox", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query(
      "SELECT id, rule_id, rule_name, \"group\", text, at, acknowledged_by FROM inbox WHERE space_id = $1 ORDER BY at DESC, id DESC",
      [ctx.spaceId],
    );
    res.json({ items: rows.rows });
  });

  router.post("/api/inbox/:id/ack", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const now = nowMs();
    const existing = await db.query(
      "SELECT * FROM inbox WHERE id = $1 AND space_id = $2",
      [req.params.id, ctx.spaceId],
    );
    if (existing.rows.length === 0) throw errors.notFound();
    const current = existing.rows[0];
    if (current.acknowledged_by) {
      res.json(current);
      return;
    }
    const updated = await db.query(
      "UPDATE inbox SET acknowledged_by = $1 WHERE id = $2 AND space_id = $3 AND acknowledged_by IS NULL RETURNING *",
      [ctx.username, req.params.id, ctx.spaceId],
    );
    const seq = nextSeq(ctx.spaceId);
    broadcastToSpace(ctx.spaceId, "inbox", { id: Number(req.params.id), acknowledged_by: ctx.username }, seq);
    res.json(updated.rows[0] ?? { ...current, acknowledged_by: ctx.username });
  });

  // ---------- Cases ----------
  router.get("/api/cases", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query(
      "SELECT number, title, status FROM cases WHERE space_id = $1 ORDER BY number DESC",
      [ctx.spaceId],
    );
    res.json({ cases: rows.rows });
  });

  router.post("/api/cases", async (req: Request, res: Response) => {
    const body = req.body as { title?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const title = String(body.title ?? "");
    if (title === "") throw errors.invalid({ title: "Check the highlighted fields." });
    const max = await db.query<{ n: string }>("SELECT coalesce(max(number), 0)::text AS n FROM cases WHERE space_id = $1", [
      ctx.spaceId,
    ]);
    const number = Number(max.rows[0].n) + 1;
    const id = nextId();
    await db.query(
      "INSERT INTO cases (id, space_id, number, title, status, created_at, updated_at) VALUES ($1,$2,$3,$4,'open',now(),now())",
      [id, ctx.spaceId, number, title],
    );
    const seq = nextSeq(ctx.spaceId);
    res.status(201).json({ number, title, status: "open", seq });
  });

  router.get("/api/cases/:number", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query(
      "SELECT * FROM cases WHERE space_id = $1 AND number = $2",
      [ctx.spaceId, Number(req.params.number)],
    );
    if (!rows.rows[0]) throw errors.notFound();
    const items = await db.query("SELECT * FROM case_items WHERE case_id = $1 ORDER BY id", [rows.rows[0].id]);
    res.json({ ...rows.rows[0], items: items.rows });
  });

  router.patch("/api/cases/:number", async (req: Request, res: Response) => {
    const body = req.body as { status?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const rows = await db.query(
      "SELECT * FROM cases WHERE space_id = $1 AND number = $2 FOR UPDATE",
      [ctx.spaceId, Number(req.params.number)],
    );
    if (!rows.rows[0]) throw errors.notFound();
    const current = rows.rows[0].status;
    const next = String(body.status ?? "");
    const legal: Record<string, string[]> = {
      open: ["investigating"],
      investigating: ["resolved"],
      resolved: ["closed", "investigating"],
      closed: [],
    };
    if (!legal[current].includes(next)) {
      throw errors.caseFlow(current, next);
    }
    await db.query("UPDATE cases SET status = $1, updated_at = now() WHERE id = $2", [next, rows.rows[0].id]);
    const seq = nextSeq(ctx.spaceId);
    broadcastToSpace(ctx.spaceId, "case", { number: Number(req.params.number), status: next }, seq);
    res.json({ ...rows.rows[0], status: next });
  });

  router.post("/api/cases/:number/items", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const rows = await db.query("SELECT * FROM cases WHERE space_id = $1 AND number = $2", [
      ctx.spaceId,
      Number(req.params.number),
    ]);
    if (!rows.rows[0]) throw errors.notFound();
    let kind: string;
    let ref: string;
    if (typeof body.rule === "string" && typeof body.group === "string") {
      kind = "group";
      ref = `${body.group} on rule ${body.rule}`;
    } else if (typeof body.inbox_item === "number" || typeof body.inbox_item === "string") {
      kind = "inbox";
      const item = await db.query("SELECT text FROM inbox WHERE id = $1 AND space_id = $2", [
        Number(body.inbox_item),
        ctx.spaceId,
      ]);
      if (item.rows.length === 0) throw errors.notFound();
      ref = item.rows[0].text;
    } else if (typeof body.trace_id === "string") {
      kind = "trace";
      const trace = await db.query("SELECT trace_id FROM traces WHERE space_id = $1 AND trace_id = $2", [
        ctx.spaceId,
        body.trace_id,
      ]);
      if (trace.rows.length === 0) throw errors.notFound();
      ref = body.trace_id;
    } else {
      throw errors.invalid({ item: "Check the highlighted fields." });
    }
    await db.query("INSERT INTO case_items (case_id, kind, ref, at) VALUES ($1,$2,$3,now())", [
      rows.rows[0].id,
      kind,
      ref,
    ]);
    const seq = nextSeq(ctx.spaceId);
    res.status(201).json({ ...rows.rows[0], seq });
  });

  // ---------- Traces ----------
  router.get("/api/traces", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query("SELECT trace_id FROM traces WHERE space_id = $1 ORDER BY trace_id", [ctx.spaceId]);
    res.json({ traces: rows.rows.map((r: { trace_id: string }) => r.trace_id) });
  });

  router.post("/api/traces", async (req: Request, res: Response) => {
    const body = req.body as { trace_id?: unknown; spans?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const traceId = String(body.trace_id ?? "");
    if (traceId === "") throw errors.invalid({ trace_id: "Check the highlighted fields." });
    const existing = await db.query("SELECT 1 FROM traces WHERE space_id = $1 AND trace_id = $2", [
      ctx.spaceId,
      traceId,
    ]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    const spans = (Array.isArray(body.spans) ? body.spans : []) as SpanInput[];
    validateTrace(spans, config().settings.trace_max_spans);
    await db.query("INSERT INTO traces (space_id, trace_id, spans, created_at) VALUES ($1,$2,$3,now())", [
      ctx.spaceId,
      traceId,
      JSON.stringify(spans),
    ]);
    res.status(201).json({ trace_id: traceId, spans: spans.length });
  });

  router.get("/api/traces/:id", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query<{ trace_id: string; spans: SpanInput[] }>(
      "SELECT trace_id, spans FROM traces WHERE space_id = $1 AND trace_id = $2",
      [ctx.spaceId, req.params.id],
    );
    if (!rows.rows[0]) throw errors.notFound();
    res.json(buildTrace(rows.rows[0].trace_id, rows.rows[0].spans));
  });

  // ---------- Objectives ----------
  router.get("/api/objectives", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM objectives WHERE space_id = $1 ORDER BY service",
      [ctx.spaceId],
    );
    const objectives = [];
    for (const r of objectiveRows(rows.rows)) {
      objectives.push(await objectiveView(db, r));
    }
    res.json({ objectives });
  });

  router.post("/api/objectives", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const fields: Record<string, string> = {};
    const service = String(body.service ?? "");
    const name = String(body.name ?? "");
    const target = Number(body.target);
    if (service === "") fields.service = "Check the highlighted fields.";
    if (name === "") fields.name = "Check the highlighted fields.";
    if (isNaN(target) || target <= 0 || target >= 100) fields.target = "Check the highlighted fields.";
    const streamName = String(body.stream ?? "");
    const stream = await requireStream(db, ctx.spaceId, streamName).catch(() => null);
    if (!stream) fields.stream = "Check the highlighted fields.";
    if (Object.keys(fields).length > 0) throw errors.invalid(fields);
    const existing = await db.query("SELECT 1 FROM objectives WHERE space_id = $1 AND service = $2", [
      ctx.spaceId,
      service,
    ]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    const windowMs = Number(body.objective_window_ms ?? 2592000000);
    await db.query(
      `INSERT INTO objectives (id, space_id, service, name, stream_id, target, objective_window_ms, bad, fixed_counts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
      [
        nextId(),
        ctx.spaceId,
        service,
        name,
        stream!.id,
        target,
        windowMs,
        JSON.stringify(body.bad ?? null),
      ],
    );
    res.status(201).json({ service, name });
  });

  // ---------- Spaces and members ----------
  router.get("/api/spaces", async (req: Request, res: Response) => {
    await withDb(async (db) => {
      const ctx = await loadContext(db, req, null);
      if (!ctx) throw errors.unauthenticated();
      const rows = await db.query(
        "SELECT s.slug, s.name, m.role FROM spaces s JOIN members m ON m.space_id = s.id WHERE m.user_id = $1",
        [ctx.userId],
      );
      res.json({ spaces: rows.rows });
    });
  });

  router.post("/api/spaces", async (req: Request, res: Response) => {
    const body = req.body as { slug?: unknown; name?: unknown };
    const { ctx, db } = await ctxFor(req, null);
    if (ctx.kind !== "session") throw errors.unauthenticated();
    const slug = String(body.slug ?? "");
    const name = String(body.name ?? "");
    const fields: Record<string, string> = {};
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) fields.slug = "Use 1 to 40 characters: a-z, 0-9 or -.";
    if (name === "") fields.name = "Check the highlighted fields.";
    if (Object.keys(fields).length > 0) throw errors.invalid(fields);
    const existing = await db.query("SELECT 1 FROM spaces WHERE slug = $1", [slug]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    const id = nextId();
    await db.query("INSERT INTO spaces (id, slug, name, seq, created_at) VALUES ($1,$2,$3,0,now())", [
      id,
      slug,
      name,
    ]);
    await db.query("INSERT INTO members (space_id, user_id, role) VALUES ($1,$2,'admin')", [id, ctx.userId]);
    const seq = nextSeq(String(id));
    res.status(201).json({ slug, name, seq });
  });

  router.post("/api/spaces/:slug/members", async (req: Request, res: Response) => {
    const body = req.body as { username?: unknown; role?: unknown };
    const { ctx, db } = await ctxFor(req, req.params.slug);
    needRole(ctx, "admin");
    const username = String(body.username ?? "").toLowerCase();
    const role = String(body.role ?? "");
    if (!["viewer", "editor", "admin"].includes(role)) {
      throw errors.invalid({ role: "Check the highlighted fields." });
    }
    const user = await db.query("SELECT id FROM users WHERE username = $1", [username]);
    if (user.rows.length === 0) throw errors.notFound();
    const existing = await db.query("SELECT 1 FROM members WHERE space_id = $1 AND user_id = $2", [
      ctx.spaceId,
      user.rows[0].id,
    ]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    await db.query("INSERT INTO members (space_id, user_id, role) VALUES ($1,$2,$3)", [
      ctx.spaceId,
      user.rows[0].id,
      role,
    ]);
    res.status(201).json({ username, role });
  });

  // ---------- Keys ----------
  router.get("/api/keys", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "admin");
    const rows = await db.query(
      "SELECT id, name, stream_pattern, actions, expires_at, revoked, last4 FROM api_keys WHERE space_id = $1 ORDER BY created_at DESC, id DESC",
      [ctx.spaceId],
    );
    res.json({ keys: rows.rows });
  });

  router.post("/api/keys", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "admin");
    const fields: Record<string, string> = {};
    const name = String(body.name ?? "");
    const pattern = String(body.stream_pattern ?? "");
    const actions = Array.isArray(body.actions) ? (body.actions as string[]) : [];
    const days = body.expires_in_days === null || body.expires_in_days === undefined ? null : Number(body.expires_in_days);
    if (name === "") fields.name = "Check the highlighted fields.";
    if (actions.some((a) => !["read", "upload", "manage"].includes(a))) fields.actions = "Check the highlighted fields.";
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
      fields.expires_in_days = "Check the highlighted fields.";
    }
    if (Object.keys(fields).length > 0) throw errors.invalid(fields);
    const key = newKey();
    const id = nextId();
    const now = nowMs();
    const expiresAt = days !== null ? new Date(now + days * 86400000) : null;
    await db.query(
      `INSERT INTO api_keys (id, space_id, name, stream_pattern, actions, key_hash, last4, expires_at, revoked, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,now())`,
      [id, ctx.spaceId, name, pattern, actions.join(","), sha256(key), key.slice(-4), expiresAt],
    );
    res.status(201).json({
      id,
      name,
      stream_pattern: pattern,
      actions,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      revoked: false,
      last4: key.slice(-4),
      key,
    });
  });

  router.delete("/api/keys/:id", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "admin");
    const rows = await db.query(
      "UPDATE api_keys SET revoked = TRUE WHERE id = $1 AND space_id = $2 RETURNING id, name, stream_pattern, actions, expires_at, last4",
      [req.params.id, ctx.spaceId],
    );
    if (rows.rows.length === 0) throw errors.notFound();
    res.json({ ...rows.rows[0], revoked: true });
  });

  // ---------- Saved searches ----------
  router.get("/api/saved-searches", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query("SELECT * FROM saved_searches WHERE space_id = $1 ORDER BY name", [ctx.spaceId]);
    const out = [];
    for (const r of rows.rows) {
      const stream = await db.query("SELECT 1 FROM streams WHERE space_id = $1 AND name = $2", [
        ctx.spaceId,
        r.stream,
      ]);
      const missing = stream.rows.length === 0;
      out.push({
        ...r,
        needs_attention: missing,
        ...(missing ? { problem: `Stream ${r.stream} doesn't exist in this space.` } : {}),
      });
    }
    res.json({ saved_searches: out });
  });

  router.post("/api/saved-searches", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const fields: Record<string, string> = {};
    const name = String(body.name ?? "");
    const stream = String(body.stream ?? "");
    if (name === "") fields.name = "Check the highlighted fields.";
    const streamRow = await requireStream(db, ctx.spaceId, stream).catch(() => null);
    if (!streamRow) fields.stream = "Check the highlighted fields.";
    if (Object.keys(fields).length > 0) throw errors.invalid(fields);
    const existing = await db.query("SELECT 1 FROM saved_searches WHERE space_id = $1 AND name = $2", [
      ctx.spaceId,
      name,
    ]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    const id = nextId();
    await db.query(
      "INSERT INTO saved_searches (id, space_id, name, stream, q, filters, from_ms, to_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        ctx.spaceId,
        name,
        stream,
        String(body.q ?? ""),
        JSON.stringify(body.filters ?? []),
        typeof body.from === "string" ? Date.parse(body.from) : Number(body.from ?? 0),
        typeof body.to === "string" ? Date.parse(body.to) : Number(body.to ?? 0),
      ],
    );
    res.status(201).json({ id, name, stream });
  });

  router.get("/api/saved-searches/:id", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const rows = await db.query("SELECT * FROM saved_searches WHERE id = $1 AND space_id = $2", [
      req.params.id,
      ctx.spaceId,
    ]);
    if (!rows.rows[0]) throw errors.notFound();
    const r = rows.rows[0];
    const stream = await db.query("SELECT 1 FROM streams WHERE space_id = $1 AND name = $2", [
      ctx.spaceId,
      r.stream,
    ]);
    const missing = stream.rows.length === 0;
    res.json({
      ...r,
      ...(missing ? { problem: `Stream ${r.stream} doesn't exist in this space.` } : {}),
    });
  });

  router.post("/api/saved-searches/:id/copy", async (req: Request, res: Response) => {
    const body = req.body as { space?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const rows = await db.query("SELECT * FROM saved_searches WHERE id = $1 AND space_id = $2", [
      req.params.id,
      ctx.spaceId,
    ]);
    if (!rows.rows[0]) throw errors.notFound();
    const target = String(body.space ?? "");
    const targetSpace = await db.query("SELECT id FROM spaces WHERE slug = $1", [target]);
    if (targetSpace.rows.length === 0) throw errors.notFound();
    const membership = await db.query("SELECT 1 FROM members WHERE space_id = $1 AND user_id = $2", [
      targetSpace.rows[0].id,
      ctx.userId,
    ]);
    if (membership.rows.length === 0) throw errors.notFound();
    const r = rows.rows[0];
    const targetStream = await db.query("SELECT 1 FROM streams WHERE space_id = $1 AND name = $2", [
      targetSpace.rows[0].id,
      r.stream,
    ]);
    const missing = targetStream.rows.length === 0;
    const newId = nextId();
    const existing = await db.query("SELECT 1 FROM saved_searches WHERE space_id = $1 AND name = $2", [
      targetSpace.rows[0].id,
      r.name,
    ]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    await db.query(
      "INSERT INTO saved_searches (id, space_id, name, stream, q, filters, from_ms, to_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        newId,
        targetSpace.rows[0].id,
        r.name,
        r.stream,
        r.q,
        r.filters,
        r.from_ms,
        r.to_ms,
      ],
    );
    const seq = nextSeq(String(targetSpace.rows[0].id));
    res.status(201).json({
      id: newId,
      space: target,
      missing: missing ? [`stream ${r.stream}`] : [],
      needs_attention: missing,
      message: missing
        ? `Copied with 1 missing reference: stream ${r.stream}.`
        : "Copied with no missing references.",
    });
  });
}

function changeCountPublic(g: { change_log: { changed: boolean }[] }): boolean {
  const look = g.change_log.slice(-config().settings.flap_checks);
  return look.filter((e) => e.changed).length >= config().settings.flap_changes;
}
