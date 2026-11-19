import { now } from "./clock.js";
import { settings } from "./config.js";
import { lockKey, type Tx } from "./db.js";
import type { Env } from "./env.js";
import { fail, notFound, validation } from "./errors.js";
import { deliver } from "./inbox.js";
import { publish } from "./live.js";
import { addActivity, findRecord } from "./records.js";
import { addDays, parseDateKey, wallToInstant, WEEKDAY_NAMES } from "../shared/tz.js";

export interface Rotation {
  name: string;
  time_zone: string;
  handover_weekday: string;
  handover_time: string;
  members: string[];
  anchor_date: string;
}

interface Shift {
  username: string;
  start: number;
  end: number;
  override: boolean;
}

export interface PolicyLevel {
  target: { rotation: string } | { user: string };
  ack_minutes: number | null;
}

export interface PageLevel {
  level: number;
  username: string;
  notified_at: string;
  ack_due_at: string;
}

export interface PageJson {
  id: number;
  record: string;
  policy: string;
  status: "paging" | "acknowledged" | "exhausted";
  level: number;
  levels: PageLevel[];
  acknowledged_by: string | null;
  acknowledged_level: number | null;
  late: boolean;
}

const WEEK = 7;

export async function loadRotation(tx: Tx, name: string): Promise<Rotation | null> {
  const rows = await tx.query("SELECT * FROM rotations WHERE name = $1", [name]);
  const r = rows[0];
  return r ? { name: r.name as string, time_zone: r.time_zone as string, handover_weekday: r.handover_weekday as string, handover_time: r.handover_time as string, members: r.members as string[], anchor_date: r.anchor_date as string } : null;
}

function shiftStart(rotation: Rotation, index: number): number {
  const anchor = parseDateKey(rotation.anchor_date);
  const weekday = (new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day)).getUTCDay() + 6) % 7;
  const wanted = WEEKDAY_NAMES.indexOf(rotation.handover_weekday as (typeof WEEKDAY_NAMES)[number]);
  const first = addDays(anchor.year, anchor.month, anchor.day, (wanted - weekday + 7) % 7);
  const day = addDays(first.year, first.month, first.day, index * WEEK);
  const [hour, minute] = rotation.handover_time.split(":").map(Number) as [number, number];
  return wallToInstant(day.year, day.month, day.day, hour, minute, rotation.time_zone);
}

function baseShift(rotation: Rotation, atMs: number): Shift {
  let index = Math.floor((atMs - shiftStart(rotation, 0)) / (WEEK * 86_400_000));
  while (shiftStart(rotation, index) > atMs) index--;
  while (shiftStart(rotation, index + 1) <= atMs) index++;
  const count = rotation.members.length;
  return { username: rotation.members[((index % count) + count) % count]!, start: shiftStart(rotation, index), end: shiftStart(rotation, index + 1), override: false };
}

async function overridesOf(tx: Tx, rotation: string): Promise<Array<Shift & { id: number }>> {
  const rows = await tx.query("SELECT * FROM overrides WHERE rotation = $1 ORDER BY id", [rotation]);
  return rows.map((r) => ({ id: r.id as number, username: r.username as string, start: Date.parse(r.start_at as string), end: Date.parse(r.end_at as string), override: true }));
}

/** Who answers at an instant: the most recent covering override, else the weekly shift. */
export async function onCallAt(tx: Tx, rotation: Rotation, atMs: number): Promise<Shift> {
  const covering = (await overridesOf(tx, rotation.name)).filter((o) => o.start <= atMs && atMs < o.end);
  const latest = covering[covering.length - 1];
  return latest ?? baseShift(rotation, atMs);
}

export async function shiftsBetween(tx: Tx, rotation: Rotation, fromMs: number, toMs: number): Promise<Shift[]> {
  const out: Shift[] = [];
  let cursor = baseShift(rotation, fromMs);
  while (cursor.start < toMs) {
    out.push(cursor);
    cursor = baseShift(rotation, cursor.end);
  }
  const overrides = (await overridesOf(tx, rotation.name)).filter((o) => o.start < toMs && o.end > fromMs);
  return [...out, ...overrides.map(({ username, start, end }) => ({ username, start, end, override: true }))].sort((a, b) => a.start - b.start);
}

export function validateRotation(rotation: Rotation): void {
  if (rotation.members.length === 0) validation("A rotation needs at least one member.", { members: "Add at least one member." });
  if (!WEEKDAY_NAMES.includes(rotation.handover_weekday as (typeof WEEKDAY_NAMES)[number])) validation("Handover weekday must be a weekday name.", { handover_weekday: "Use a weekday such as monday." });
}

async function resolveTarget(tx: Tx, target: PolicyLevel["target"], atMs: number): Promise<string> {
  if ("user" in target) return target.user;
  const rotation = await loadRotation(tx, target.rotation);
  if (!rotation) return validation(`Unknown rotation "${target.rotation}".`);
  return (await onCallAt(tx, rotation, atMs)).username;
}

function minutesOf(level: PolicyLevel): number {
  return level.ack_minutes ?? settings.ONCALL_ACK_MINUTES;
}

function pageOf(row: Record<string, unknown>): PageJson {
  return {
    id: row.id as number,
    record: row.record_number as string,
    policy: row.policy as string,
    status: row.status as PageJson["status"],
    level: row.level as number,
    levels: row.levels as PageLevel[],
    acknowledged_by: (row.acknowledged_by as string | null) ?? null,
    acknowledged_level: (row.acknowledged_level as number | null) ?? null,
    late: row.late as boolean,
  };
}

export async function listPages(tx: Tx): Promise<PageJson[]> {
  return (await tx.query("SELECT * FROM pages ORDER BY id DESC")).map(pageOf);
}

async function notifyLevel(env: Env, number: string, username: string): Promise<void> {
  await deliver(env.tx, "page", [username], `Page for ${number}: please acknowledge.`, number);
}

export async function startPage(env: Env, number: string, policyName: string): Promise<PageJson> {
  const policy = (await env.tx.query("SELECT levels FROM escalation_policies WHERE name = $1", [policyName]))[0];
  if (!policy) return validation(`Unknown escalation policy "${policyName}".`, { policy: "Choose an existing policy." });
  const record = await findRecord(env.tx, number);
  if (!record) return notFound();
  await lockKey(env.tx, `paging:${number}`);
  const active = await env.tx.query("SELECT 1 FROM pages WHERE record_number = $1 AND status = 'paging'", [number]);
  if (active.length > 0) fail(409, "already_paging", "A page is already open for this record.");
  const levels = policy.levels as PolicyLevel[];
  const at = now();
  const username = await resolveTarget(env.tx, levels[0]!.target, at);
  const first: PageLevel = { level: 1, username, notified_at: new Date(at).toISOString(), ack_due_at: new Date(at + minutesOf(levels[0]!) * 60_000).toISOString() };
  const rows = await env.tx.query("INSERT INTO pages (record_number, policy, status, level, levels, created_at) VALUES ($1, $2, 'paging', 1, $3, $4) RETURNING *", [number, policyName, JSON.stringify([first]), new Date(at).toISOString()]);
  await notifyLevel(env, number, username);
  env.tx.after.push(() => publish("list:page", "changed", { number }));
  return pageOf(rows[0]!);
}

export async function maybeStartPage(env: Env, rec: { number: string; fields: Record<string, unknown> }): Promise<void> {
  const group = typeof rec.fields.assignment_group === "string" ? env.world.groups.get(rec.fields.assignment_group) : undefined;
  if (!group?.escalation_policy) return;
  await lockKey(env.tx, `paging:${rec.number}`);
  const active = await env.tx.query("SELECT 1 FROM pages WHERE record_number = $1 AND status = 'paging'", [rec.number]);
  if (active.length === 0) await startPage(env, rec.number, group.escalation_policy);
}

export async function acknowledge(env: Env, id: number): Promise<PageJson> {
  const rows = await env.tx.query("SELECT * FROM pages WHERE id = $1 FOR UPDATE", [id]);
  if (!rows[0]) return notFound();
  const page = pageOf(rows[0]);
  const me = env.user.username;
  const paged = page.levels.find((l) => l.username === me);
  const isOperator = env.user.roles.includes("operator");
  if (!paged && !isOperator) fail(403, "not_paged", "You were not paged for this.");
  if (page.status === "acknowledged") fail(409, "already_acknowledged", `Already acknowledged by ${env.world.displayName(page.acknowledged_by)}.`);
  const level = paged?.level ?? page.level;
  const late = page.status === "exhausted" || level < page.level;
  const name = env.world.displayName(me);
  await env.tx.query("UPDATE pages SET status = 'acknowledged', acknowledged_by = $2, acknowledged_level = $3, late = $4 WHERE id = $1", [id, me, level, late]);
  await addActivity(env, page.record, "system", late ? `Late acknowledge from ${name} at level ${level}; paging had reached level ${page.level}.` : `Acknowledged by ${name} at level ${level}.`, { system: true });
  env.tx.after.push(() => {
    publish("list:page", "changed", { number: page.record });
    publish(`record:${page.record}`, "changed", { number: page.record });
  });
  return { ...page, status: "acknowledged", acknowledged_by: me, acknowledged_level: level, late };
}

export async function nextPageDue(tx: Tx): Promise<number | null> {
  const rows = await tx.query("SELECT levels, level FROM pages WHERE status = 'paging'");
  const dues = rows.map((r) => Date.parse((r.levels as PageLevel[])[(r.level as number) - 1]!.ack_due_at));
  return dues.length === 0 ? null : Math.min(...dues);
}

/** Climbs every unacknowledged page whose current level timer has run out by the instant, in time order. */
export async function climbDue(env: Env, atMs: number): Promise<boolean> {
  const rows = await env.tx.query("SELECT * FROM pages WHERE status = 'paging' ORDER BY id");
  let climbed = false;
  for (const row of rows) {
    const page = pageOf(row);
    const current = page.levels[page.level - 1]!;
    const due = Date.parse(current.ack_due_at);
    if (due > atMs) continue;
    climbed = true;
    const policy = (await env.tx.query("SELECT levels FROM escalation_policies WHERE name = $1", [page.policy]))[0];
    const levels = (policy?.levels as PolicyLevel[] | undefined) ?? [];
    const next = levels[page.level];
    if (!next) {
      await env.tx.query("UPDATE pages SET status = 'exhausted' WHERE id = $1", [page.id]);
      const operators = (await env.tx.query("SELECT username FROM users WHERE 'operator' = ANY(roles)")).map((r) => r.username as string);
      await deliver(env.tx, "page_exhausted", operators, `Page for ${page.record} was not acknowledged at any level.`, page.record);
    } else {
      const username = await resolveTarget(env.tx, next.target, due);
      const entry: PageLevel = { level: page.level + 1, username, notified_at: new Date(due).toISOString(), ack_due_at: new Date(due + minutesOf(next) * 60_000).toISOString() };
      await env.tx.query("UPDATE pages SET level = $2, levels = $3 WHERE id = $1", [page.id, page.level + 1, JSON.stringify([...page.levels, entry])]);
      await notifyLevel(env, page.record, username);
    }
    env.tx.after.push(() => publish("list:page", "changed", { number: page.record }));
  }
  return climbed;
}

