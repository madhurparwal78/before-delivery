import type { Value } from "../../shared/expression.js";
import { composeFilter } from "../../shared/filtertext.js";
import { fieldsOf, tableOfNumber } from "../../shared/fields.js";
import { TABLES, type Table } from "../../shared/types.js";
import { now } from "../clock.js";
import { transaction } from "../db.js";
import { Env, type Principal } from "../env.js";
import { ApiError, notFound, validation } from "../errors.js";
import { createExport, exportFile, loadExport, requireTable, retryExport } from "../exports.js";
import { attachmentsOf, download, requireFile, upload } from "../files.js";
import { commitImport, previewImport } from "../imports.js";
import { aggregate, listRecords, matching, parseBuilder, searchRecords, unknownField } from "../lists.js";
import { deliver } from "../inbox.js";
import { publish } from "../live.js";
import { addActivity, findRecord, recordView, save } from "../records.js";
import { assign } from "../rules.js";
import { numberParam, reply, requireOperator, requireRole, requireSession, route, withEnv, type Ctx } from "../http.js";
import { slaViews } from "../sla.js";
import { composeFilter as compose } from "../../shared/filtertext.js";
import { rank } from "../knowledge.js";
import type { RecordObj } from "../world.js";

function tableParam(ctx: Ctx): Table {
  const value = ctx.params.table;
  return TABLES.includes(value as Table) ? (value as Table) : notFound();
}

async function present(env: Env, rec: RecordObj): Promise<Record<string, unknown>> {
  return { ...(await recordView(env, rec)), attachments: await attachmentsOf(env.tx, rec.number) };
}

async function visible(env: Env, number: string): Promise<RecordObj> {
  const rec = await findRecord(env.tx, number);
  if (!rec || !(await env.access()).canRead(rec)) return notFound();
  return rec;
}

function submittedOf(body: { fields?: Record<string, { value: Value; version?: number } | undefined> }): Record<string, { value: Value; version?: number }> {
  const out: Record<string, { value: Value; version?: number }> = {};
  for (const [name, entry] of Object.entries(body.fields ?? {})) {
    if (entry === undefined || typeof entry !== "object" || entry === null || !("value" in entry)) return validation(`Send ${name} as {"value", "version"}.`, { [name]: "Send a value and its version." });
    out[name] = { value: entry.value, ...(typeof entry.version === "number" ? { version: entry.version } : {}) };
  }
  return out;
}

route("GET", "/api/tables/:table/records", async (ctx) =>
  withEnv(ctx, async (env) => {
    const table = tableParam(ctx);
    const q = ctx.query;
    return reply(200, await listRecords(env, table, { filter: q.get("filter") ?? undefined, q: q.get("q") ?? undefined, sort: q.get("sort") ?? undefined, dir: q.get("dir") ?? undefined, page: q.get("page") ? Number(q.get("page")) : undefined, group_by: q.get("group_by") ?? undefined, columns: q.get("columns") ?? undefined }));
  }),
);

route("POST", "/api/tables/:table/records", async (ctx) =>
  withEnv(ctx, async (env) => {
    const table = tableParam(ctx);
    const fields = ctx.json<{ fields?: Record<string, Value> }>().fields ?? {};
    const rec = await save(env, { table, number: null, submitted: Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, { value }])) });
    return reply(201, { record: await present(env, rec) });
  }),
);

route("POST", "/api/records/bulk", async (ctx) => {
  const session = requireSession(ctx);
  const body = ctx.json<{ numbers?: string[]; fields?: Record<string, Value> }>();
  if (!Array.isArray(body.numbers) || typeof body.fields !== "object" || body.fields === null) return validation("Send numbers and fields.");
  const principal: Principal = { user: session.user, actor: session.actor.username, actingFor: session.impersonating ? session.user.username : null };
  const results: Array<{ number: string; ok: boolean; message?: string }> = [];
  for (const number of body.numbers) {
    const table = tableOfNumber(number);
    try {
      if (!table) throw new ApiError(404, "not_found", "No such record.");
      await transaction(async (tx) => {
        const env = await Env.create(tx, principal);
        await save(env, { table, number, submitted: Object.fromEntries(Object.entries(body.fields!).map(([k, value]) => [k, { value }])) });
      });
      results.push({ number, ok: true });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      results.push({ number, ok: false, message: error.message });
    }
  }
  return reply(200, { results });
});

route("GET", "/api/records/:number", async (ctx) => withEnv(ctx, async (env) => reply(200, { record: await present(env, await visible(env, ctx.params.number!)) })));

route("PATCH", "/api/records/:number", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    const saved = await save(env, { table: rec.table, number: rec.number, submitted: submittedOf(ctx.json()) });
    return reply(200, { record: await present(env, saved) });
  }),
);

route("POST", "/api/records/:number/transition", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    const body = ctx.json<{ to?: unknown; fields?: Record<string, { value: Value; version?: number }> }>();
    if (typeof body.to !== "string") return validation("Name the state to move to.", { to: "State is required." });
    const saved = await save(env, { table: rec.table, number: rec.number, submitted: submittedOf(body), to: body.to });
    return reply(200, { record: await present(env, saved) });
  }),
);

const MENTION = /@([a-z0-9._-]+)/g;

async function addNote(ctx: Ctx, kind: "work_note" | "comment"): Promise<ReturnType<typeof reply>> {
  return withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    if (kind === "work_note") requireRole(env, ["operator", "technician"]);
    const text = ctx.json<{ text?: unknown }>().text;
    if (typeof text !== "string" || text.length < 1 || text.length > 10_000) return validation("Notes are 1 to 10,000 characters.", { text: "Write between 1 and 10,000 characters." });
    await addActivity(env, rec.number, kind, text);
    for (const mention of new Set([...text.matchAll(MENTION)].map((m) => m[1]!))) {
      if (env.world.people.get(mention)?.hasLogin) await deliver(env.tx, "mentioned", [mention], `${env.user.display_name} mentioned you on ${rec.number}.`, rec.number);
    }
    if (kind === "comment" && rec.table === "incident" && rec.fields.state === "on_hold" && rec.fields.hold_reason === "awaiting_requester" && rec.fields.caller === env.user.username) {
      await save(env, { table: "incident", number: rec.number, submitted: {}, to: "in_progress", system: true });
    }
    env.tx.after.push(() => {
      publish(`record:${rec.number}`, "activity", { number: rec.number });
      if (rec.fields.is_major === true) publish(`major:${rec.number}`, "changed", {});
    });
    return reply(201, { entry: { at: new Date(now()).toISOString(), actor: env.user.display_name, acting_for: env.who.actingFor ? env.user.display_name : null, kind, text } });
  });
}

route("POST", "/api/records/:number/work-notes", (ctx) => addNote(ctx, "work_note"));
route("POST", "/api/records/:number/comments", (ctx) => addNote(ctx, "comment"));

route("GET", "/api/records/:number/activity", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    const access = await env.access();
    const readable = access.readable(rec);
    const desk = env.user.roles.includes("operator") || env.user.roles.includes("technician");
    const rows = await env.tx.query("SELECT at, actor, acting_for, kind, text, field FROM activity WHERE record_number = $1 ORDER BY id DESC", [rec.number]);
    const entries = rows
      .filter((r) => (desk || r.kind !== "work_note") && (r.field === null || readable.has(r.field as string)))
      .filter((r) => desk || r.kind !== "system" || !String(r.text).startsWith("Assigned to") || readable.has("assigned_to"))
      .map((r) => ({ at: r.at, actor: r.actor ? env.world.displayName(r.actor as string) : null, acting_for: r.acting_for ? env.world.displayName(r.acting_for as string) : null, kind: r.kind, text: r.text }));
    return reply(200, { entries });
  }),
);

route("GET", "/api/records/:number/audit", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    requireRole(env, ["operator", "technician"]);
    const readable = (await env.access()).readable(rec);
    const rows = await env.tx.query("SELECT at, actor, acting_for, field, before, after, reason FROM audit WHERE record_number = $1 ORDER BY id DESC", [rec.number]);
    return reply(200, {
      entries: rows
        .filter((r) => readable.has(r.field as string))
        .map((r) => ({ at: r.at, actor: r.actor ? env.world.displayName(r.actor as string) : null, acting_for: r.acting_for ? env.world.displayName(r.acting_for as string) : null, field: r.field, before: r.before, after: r.after, reason: r.reason ?? null })),
    });
  }),
);

route("GET", "/api/records/:number/sla", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    return reply(200, { slas: await slaViews(env.tx, rec, env.world, await env.slaCatalog()) });
  }),
);

route("POST", "/api/records/:number/priority-override", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    requireOperator(env);
    const body = ctx.json<{ priority?: unknown; reason?: unknown }>();
    const errors: Record<string, string> = {};
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority) || body.priority < 1 || body.priority > 5) errors.priority = "Priority must be a whole number from 1 to 5.";
    if (typeof body.reason !== "string" || body.reason.length < 1 || body.reason.length > 500) errors.reason = "A reason of 1 to 500 characters is required.";
    if (Object.keys(errors).length > 0) return validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
    const saved = await save(env, { table: rec.table, number: rec.number, submitted: {}, override: { priority: body.priority as number, reason: body.reason as string } });
    return reply(200, { record: await present(env, saved) });
  }),
);

route("DELETE", "/api/records/:number/priority-override", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    requireOperator(env);
    const saved = await save(env, { table: rec.table, number: rec.number, submitted: {}, override: null });
    return reply(200, { record: await present(env, saved) });
  }),
);

route("POST", "/api/records/:number/assign-by-rules", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    requireRole(env, ["operator", "technician"]);
    const outcome = await assign(env.tx, env.world, await env.assignmentRules(), { table: rec.table, number: rec.number, fields: rec.fields, actor: env.actorRef });
    if (!outcome) return reply(200, { record: await present(env, rec) });
    const assignee = outcome.assignee;
    const saved = await save(env, { table: rec.table, number: rec.number, submitted: { assignment_group: { value: assignee ? outcome.group : "Triage" }, assigned_to: { value: assignee } } });
    await addActivity(env, rec.number, "system", assignee ? `Assigned to ${env.world.displayName(assignee)} by rule "${outcome.rule}".` : `No one in ${outcome.group} could take ${rec.number}; sent to Triage.`, { system: true });
    return reply(200, { record: await present(env, saved) });
  }),
);

route("POST", "/api/records/:number/attachments", async (ctx) =>
  withEnv(ctx, async (env) => {
    const file = requireFile(ctx.multipart().files);
    const result = await upload(env, ctx.params.number!, file);
    return reply(result.status, { attachment: result.attachment });
  }),
);

route("GET", "/api/attachments/:id", async (ctx) =>
  withEnv(ctx, async (env) => {
    const file = await download(env, numberParam(ctx, "id"));
    return { status: 200, raw: file.data, type: file.type };
  }),
);

route("GET", "/api/search", async (ctx) =>
  withEnv(ctx, async (env) => {
    const q = ctx.query.get("q") ?? "";
    const found = q.trim() === "" ? [] : await searchRecords(env, q);
    const articles = q.trim() === "" ? [] : (await rank(env, q)).slice(0, 10);
    return reply(200, { records: found, articles });
  }),
);

route("GET", "/api/filters", async (ctx) =>
  withEnv(ctx, async (env) => {
    const table = ctx.query.get("table");
    const rows = await env.tx.query("SELECT * FROM filters WHERE (shared OR owner = $1) AND ($2::text IS NULL OR table_name = $2) ORDER BY id", [env.user.username, table]);
    return reply(200, { filters: rows.map((f) => ({ id: f.id, name: f.name, table: f.table_name, filter: f.filter, shared: f.shared })) });
  }),
);

route("POST", "/api/filters", async (ctx) =>
  withEnv(ctx, async (env) => {
    const body = ctx.json<{ name?: unknown; table?: unknown; filter?: unknown; shared?: unknown }>();
    const table = requireTable(body.table);
    if (typeof body.name !== "string" || body.name.trim() === "") return validation("A filter needs a name.", { name: "Name is required." });
    const text = typeof body.filter === "string" ? body.filter : "";
    parseBuilder(table, text, await env.access());
    const rows = await env.tx.query("INSERT INTO filters (name, table_name, filter, shared, owner) VALUES ($1, $2, $3, $4, $5) RETURNING *", [body.name, table, text, body.shared === true, env.user.username]);
    const f = rows[0]!;
    return reply(201, { filter: { id: f.id, name: f.name, table: f.table_name, filter: f.filter, shared: f.shared } });
  }),
);

route("POST", "/api/filters/parse", async (ctx) =>
  withEnv(ctx, async (env) => {
    const body = ctx.json<{ table?: unknown; filter?: unknown }>();
    const table = requireTable(body.table);
    const builder = parseBuilder(table, typeof body.filter === "string" ? body.filter : "", await env.access());
    return reply(200, { builder, filter: composeFilter(builder) });
  }),
);

route("POST", "/api/filters/compose", async (ctx) =>
  withEnv(ctx, async (env) => {
    const body = ctx.json<{ table?: unknown; builder?: Parameters<typeof compose>[0] }>();
    const table = requireTable(body.table);
    if (!body.builder || !Array.isArray(body.builder.groups)) return validation("Send a builder.", { builder: "Builder is required." });
    const access = await env.access();
    for (const group of body.builder.groups) for (const c of group.conditions) if (!fieldsOf(table).some((f) => f.name === c.path.split(".")[0]) || !access.readableForTable(table, c.path.split(".")[0]!)) unknownField(c.path);
    return reply(200, { filter: compose(body.builder) });
  }),
);

route("POST", "/api/reports/aggregate", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician", "manager"]);
    const body = ctx.json<Parameters<typeof aggregate>[1]>();
    return reply(200, await aggregate(env, { ...body, table: requireTable(body.table) }));
  }),
);

route("GET", "/api/dashboards/:id", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician", "manager"]);
    const row = (await env.tx.query("SELECT * FROM dashboards WHERE id = $1", [ctx.params.id]))[0];
    if (!row) return notFound();
    const widgets = [];
    for (const w of row.widgets as Array<{ id: string; title: string; kind: string; table: Table; filter: string; group_by: string | null; bucket: "day" | "week" | null; date_field?: string | null }>) {
      const data = await aggregate(env, w.kind === "trend" ? { table: w.table, filter: w.filter, bucket: w.bucket, date_field: w.date_field ?? "created_at", time_zone: env.user.time_zone } : { table: w.table, filter: w.filter, group_by: w.group_by });
      const { visible: all } = await matching(env, w.table, { filter: w.filter });
      const groups = w.kind === "count" ? [{ key: "count", label: w.title, count: all.length, filter: w.filter ? composeFilter(parseBuilder(w.table, w.filter, await env.access())) : "" }] : data.groups;
      widgets.push({ ...w, data: groups, total: w.kind === "count" ? all.length : data.total });
    }
    return reply(200, { dashboard: { id: row.id, name: row.name, time_zone: env.user.time_zone, widgets } });
  }),
);

route("POST", "/api/exports", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician", "manager"]);
    const body = ctx.json<{ table?: unknown; filter?: string; columns?: string[] }>();
    return reply(202, { export: await createExport(env, { table: requireTable(body.table), filter: body.filter, columns: body.columns }) });
  }),
);

route("GET", "/api/exports/:id", async (ctx) => withEnv(ctx, async (env) => reply(200, { export: await loadExport(env, numberParam(ctx, "id")) })));
route("POST", "/api/exports/:id/retry", async (ctx) => withEnv(ctx, async (env) => reply(202, { export: await retryExport(env, numberParam(ctx, "id")) })));
route("GET", "/api/exports/:id/file", async (ctx) =>
  withEnv(ctx, async (env) => ({ status: 200, raw: await exportFile(env, numberParam(ctx, "id")), type: "text/csv; charset=utf-8" })),
);

route("POST", "/api/imports", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const form = ctx.multipart();
    const file = requireFile(form.files);
    return reply(201, { import: await previewImport(env, form.fields.table, file.filename, file.data, form.fields.mapping) });
  }),
);

route("POST", "/api/imports/:id/commit", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { import: await commitImport(env, numberParam(ctx, "id")) });
  }),
);
