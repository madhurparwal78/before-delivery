// Alert rules, group handling, maintenance windows, the inbox and cases.
import { now } from "../clock";
import { pool } from "../db";
import { errors } from "../errors";
import { authorize, findStream, type Access } from "../access";
import { ok, reply, route, type Ctx } from "../http";
import { currentSeq } from "../live";
import { FILTER_OPS, type Filter, type FilterOp } from "../search/filters";
import { isKnownZone } from "../../shared/zone";
import { Check, rowId } from "../validate";
import { acknowledgeGroup, acknowledgeItem, snoozeGroup, SNOOZE_MS, type SnoozeFor } from "../alerts/actions";
import { WEEK_DAYS } from "../alerts/maintenance";
import { inboxView, loadInbox, loadRule, loadRules, loadWindows, maintenanceView, ruleView, type Frequency, type RuleRow } from "../alerts/store";
import { addCaseItem, caseView, CASE_STATUSES, createCase, findCase, listCases, moveCase, caseSummary, type CaseItemRef, type CaseStatus } from "../alerts/cases";

const MEASURES = ["count", "avg", "max", "min", "sum"];
const COMPARISONS = [">", ">=", "<", "<="];

async function ruleIn(access: Access, raw: string): Promise<RuleRow> {
  const id = rowId(raw);
  const rule = id === null ? null : await loadRule(pool, access.space.id, id);
  if (!rule) throw errors.notFound();
  return rule;
}

route("GET", "/api/rules", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  const at = now();
  const rules = await loadRules(pool, access.space.id);
  return ok({ rules: await Promise.all(rules.map((rule) => ruleView(pool, rule, at, false))) });
});

route("GET", "/api/rules/:id", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  return ok(await ruleView(pool, await ruleIn(access, ctx.params.id as string), now()));
});

function frequencyOf(raw: unknown, check: Check): Frequency {
  const frequency = raw as { kind?: unknown; every_ms?: unknown } | null;
  if (frequency?.kind === "change" || frequency?.kind === "check") return { kind: frequency.kind };
  if (frequency?.kind === "throttle" && typeof frequency.every_ms === "number" && Number.isInteger(frequency.every_ms) && frequency.every_ms > 0) {
    return { kind: "throttle", every_ms: frequency.every_ms };
  }
  check.fail("frequency", "Choose how often actions fire.");
  return { kind: "change" };
}

function filterOf(raw: unknown, check: Check): Filter | null {
  if (raw === null || raw === undefined) return null;
  const filter = raw as Record<string, unknown>;
  if (typeof filter.field !== "string" || filter.field === "" || !FILTER_OPS.includes(filter.op as FilterOp)) {
    check.fail("filter", "Enter a field and an operator.");
    return null;
  }
  return { field: filter.field, op: filter.op as FilterOp, value: filter.value };
}

route("POST", "/api/rules", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "editor" });
  const body = ctx.json();
  const name = typeof body.name === "string" ? body.name : "";
  const { rows: taken } = await pool.query("SELECT 1 FROM rules WHERE space_id = $1 AND name = $2", [access.space.id, name]);
  if (taken.length > 0) throw errors.nameTaken({ name: "That name is already used." });
  const check = new Check();
  check.text(body, "name", "Enter a rule name.", 80);
  const stream = typeof body.stream === "string" ? await findStream(access.space.id, body.stream) : null;
  if (!stream) check.fail("stream", "Choose a stream in this space.");
  if (!MEASURES.includes(body.measure as string)) check.fail("measure", "Choose count, avg, max, min or sum.");
  const measureField = typeof body.measure_field === "string" && body.measure_field !== "" ? body.measure_field : null;
  if (body.measure !== "count" && measureField === null) check.fail("measure_field", "Enter the number field to measure.");
  const windowMs = check.whole(body, "window_ms", "Enter a window in whole milliseconds.", 1);
  if (!COMPARISONS.includes(body.comparison as string)) check.fail("comparison", "Choose >, >=, < or <=.");
  if (typeof body.threshold !== "number" || !Number.isFinite(body.threshold)) check.fail("threshold", "Enter a number.");
  const frequency = frequencyOf(body.frequency, check);
  const filter = filterOf(body.filter, check);
  check.done();
  const groupBy = typeof body.group_by === "string" && body.group_by !== "" ? body.group_by : null;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO rules (space_id, name, stream, filter, measure, measure_field, group_by, window_ms, comparison, threshold, frequency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [access.space.id, name, body.stream, filter && JSON.stringify(filter), body.measure, body.measure === "count" ? null : measureField, groupBy, windowMs, body.comparison, body.threshold, JSON.stringify(frequency)],
  );
  const rule = (await loadRule(pool, access.space.id, (rows[0] as { id: number }).id)) as RuleRow;
  return reply(201, { ...(await ruleView(pool, rule, now())), seq: await currentSeq(access.space.id) });
});

async function groupIn(ctx: Ctx) {
  const access = await authorize(ctx);
  const rule = await ruleIn(access, ctx.params.id as string);
  const name = ctx.params.group as string;
  const { rows } = await pool.query("SELECT 1 FROM rule_groups WHERE rule_id = $1 AND name = $2", [rule.id, name]);
  if (rows.length === 0) throw errors.notFound();
  access.require("editor");
  return { access, rule, name };
}

async function groupResult(rule: RuleRow, name: string) {
  const view = (await ruleView(pool, rule, now(), false)).groups.find((g) => g.group === name);
  return view;
}

route("POST", "/api/rules/:id/groups/:group/snooze", "json", async (ctx) => {
  const { rule, name } = await groupIn(ctx);
  const duration = ctx.json().for;
  if (duration !== "recovered" && !(typeof duration === "string" && duration in SNOOZE_MS)) throw errors.invalid({ for: "Choose 1h, 1d or recovered." });
  const seq = await snoozeGroup(rule, name, duration as SnoozeFor);
  return ok({ ...(await groupResult(rule, name)), seq });
});

route("POST", "/api/rules/:id/groups/:group/ack", "none", async (ctx) => {
  const { access, rule, name } = await groupIn(ctx);
  const seq = await acknowledgeGroup(rule, name, (access.principal as { username: string }).username);
  return ok({ ...(await groupResult(rule, name)), seq });
});

route("GET", "/api/maintenance", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  const at = now();
  return ok({ maintenance: (await loadWindows(pool, access.space.id)).map((window) => maintenanceView(window, at)) });
});

route("POST", "/api/maintenance", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "editor" });
  const body = ctx.json();
  const check = new Check();
  check.text(body, "name", "Enter a window name.", 80);
  if (typeof body.time_zone !== "string" || !isKnownZone(body.time_zone)) check.fail("time_zone", "Choose an IANA time zone.");
  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length === 0 || !days.every((day) => (WEEK_DAYS as readonly string[]).includes(day as string))) check.fail("days", "Choose at least one day.");
  if (typeof body.start !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.start)) check.fail("start", "Enter a start as HH:MM.");
  const durationMs = check.whole(body, "duration_ms", "Enter a duration in whole milliseconds.", 1);
  const ruleId = rowId(body.rule);
  const rule = ruleId === null ? null : await loadRule(pool, access.space.id, ruleId);
  if (!rule) check.fail("rule", "Choose a rule.");
  check.done();
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO maintenance_windows (space_id, name, time_zone, days, start, duration_ms, rule_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [access.space.id, body.name, body.time_zone, days, body.start, durationMs, ruleId],
  );
  const window = (await loadWindows(pool, access.space.id)).find((w) => w.id === (rows[0] as { id: number }).id) as NonNullable<Awaited<ReturnType<typeof loadWindows>>[number]>;
  return reply(201, { ...maintenanceView(window, now()), seq: await currentSeq(access.space.id) });
});

route("GET", "/api/inbox", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  return ok({ items: (await loadInbox(access.space.id)).map(inboxView) });
});

route("POST", "/api/inbox/:id/ack", "none", async (ctx) => {
  const access = await authorize(ctx);
  const id = rowId(ctx.params.id);
  if (id === null) throw errors.notFound();
  const { rows } = await pool.query("SELECT 1 FROM inbox_items WHERE id = $1 AND space_id = $2", [id, access.space.id]);
  if (rows.length === 0) throw errors.notFound();
  access.require("editor");
  const { item, seq } = await acknowledgeItem(access.space.id, id, (access.principal as { username: string }).username);
  return ok({ ...inboxView(item), seq });
});

route("GET", "/api/cases", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  return ok({ cases: (await listCases(access.space.id)).map(caseSummary) });
});

route("POST", "/api/cases", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "editor" });
  const body = ctx.json();
  const check = new Check();
  const title = check.text(body, "title", "Enter a case title.", 120);
  check.done();
  const { row, seq } = await createCase(access.space.id, title);
  return reply(201, { number: row.number, title: row.title, status: "open", seq });
});

async function caseIn(access: Access, raw: string) {
  const number = rowId(raw);
  const found = number === null ? null : await findCase(access.space.id, number);
  if (!found) throw errors.notFound();
  return found;
}

route("GET", "/api/cases/:number", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  return ok(await caseView(await caseIn(access, ctx.params.number as string)));
});

route("PATCH", "/api/cases/:number", "json", async (ctx) => {
  const access = await authorize(ctx);
  const found = await caseIn(access, ctx.params.number as string);
  access.require("editor");
  const status = ctx.json().status;
  if (!CASE_STATUSES.includes(status as CaseStatus)) throw errors.invalid({ status: "Choose open, investigating, resolved or closed." });
  const { row, seq } = await moveCase(access.space.id, found.number, status as CaseStatus);
  return ok({ ...(await caseView(row)), seq });
});

route("POST", "/api/cases/:number/items", "json", async (ctx) => {
  const access = await authorize(ctx);
  const found = await caseIn(access, ctx.params.number as string);
  access.require("editor");
  const body = ctx.json();
  let item: CaseItemRef;
  if (body.inbox_item !== undefined) {
    const { rows } = await pool.query("SELECT 1 FROM inbox_items WHERE id = $1 AND space_id = $2", [Number(body.inbox_item) || 0, access.space.id]);
    if (rows.length === 0) throw errors.invalid({ inbox_item: "That inbox item doesn't exist in this space." });
    item = { inbox_item: Number(body.inbox_item) };
  } else if (body.trace_id !== undefined) {
    const { rows } = await pool.query("SELECT 1 FROM traces WHERE space_id = $1 AND trace_id = $2", [access.space.id, String(body.trace_id)]);
    if (rows.length === 0) throw errors.invalid({ trace_id: "That trace doesn't exist in this space." });
    item = { trace_id: String(body.trace_id) };
  } else {
    const rule = await loadRule(pool, access.space.id, Number(body.rule) || 0);
    const { rows } = rule ? await pool.query("SELECT 1 FROM rule_groups WHERE rule_id = $1 AND name = $2", [rule.id, String(body.group)]) : { rows: [] };
    if (!rule || rows.length === 0) throw errors.invalid({ group: "That group doesn't exist on this rule." });
    item = { rule: rule.id, group: String(body.group) };
  }
  const seq = await addCaseItem(access.space.id, found, item);
  return reply(201, { ...(await caseView(found)), seq });
});
