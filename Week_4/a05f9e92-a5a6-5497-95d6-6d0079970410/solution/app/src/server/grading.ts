import type { Value } from "../shared/expression.js";
import { loadUser, startSession } from "./auth.js";
import { saveConfig, type ConfigKind } from "./admin.js";
import { resetClock } from "./clock.js";
import { applySetting, isSettingName, resetSettings, settings } from "./config.js";
import { createCi, addRelationship } from "./cis.js";
import { transaction } from "./db.js";
import { Env, SYSTEM, type Principal } from "./env.js";
import { fail, notFound, validation } from "./errors.js";
import { forgetRateLimits, reply, route, sessionCookie } from "./http.js";
import { createArticleFixture } from "./knowledge.js";
import { recordView, save } from "./records.js";
import { resetSlaCaches } from "./sla.js";
import { moveClock } from "./scheduler.js";
import { seedIfEmpty } from "./seed.js";
import { deleteAllObjects, setEndpoint } from "./storage.js";
import { createUser } from "./routes/core.js";
import { createOverride, createPolicy, createRotation, saveBoard, createFreeze } from "./routes/domain.js";
import { World, type StateEntry } from "./world.js";
import { isAvailable } from "./storage.js";
import { SETTING_NAMES } from "./config.js";

type Item = Record<string, unknown>;

interface Fixtures {
  departments?: Array<string | Item>;
  people?: Item[];
  users?: Item[];
  groups?: Item[];
  schedules?: Item[];
  sla_definitions?: Item[];
  cis?: Item[];
  relationships?: Item[];
  maintenance?: Item[];
  rotations?: Item[];
  overrides?: Item[];
  escalation_policies?: Item[];
  assignment_rules?: Item[];
  business_rules?: Item[];
  access_rules?: Item[];
  form_policies?: Item[];
  catalog_items?: Item[];
  guides?: Item[];
  workflows?: Item[];
  boards?: Item[];
  freeze_windows?: Item[];
  delegations?: Item[];
  records?: Item[];
  votes?: Item[];
  knowledge_articles?: Item[];
  inbox_rules?: Item[];
  dashboards?: Item[];
}

const CONFIG_KINDS: Array<[keyof Fixtures, ConfigKind]> = [
  ["schedules", "schedule"],
  ["sla_definitions", "sla_definition"],
  ["assignment_rules", "assignment_rule"],
  ["business_rules", "business_rule"],
  ["access_rules", "access_rule"],
  ["form_policies", "form_policy"],
  ["catalog_items", "catalog_item"],
  ["inbox_rules", "inbox_rule"],
];

const workspaceOf = (item: Item): "live" | "test" => (item.workspace === "test" ? "test" : "live");

async function createFixtures(env: Env, body: Fixtures): Promise<Record<string, Array<Record<string, unknown>>>> {
  const created: Record<string, Array<Record<string, unknown>>> = {};
  const note = (kind: string, entry: Record<string, unknown>): void => {
    (created[kind] ??= []).push(entry);
  };
  for (const d of body.departments ?? []) {
    const name = typeof d === "string" ? d : String(d.name);
    await env.tx.query("INSERT INTO departments (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
    note("departments", { id: name, name });
  }
  for (const p of body.people ?? []) {
    if (!(await env.tx.query("SELECT 1 FROM departments WHERE name = $1", [p.department])).length) validation(`Department "${String(p.department)}" does not exist.`, { department: "Choose an existing department." });
    await env.tx.query("INSERT INTO people (username, display_name, department) VALUES ($1, $2, $3)", [p.username, p.display_name, p.department]);
    note("people", { id: p.username, name: p.username });
  }
  for (const u of body.users ?? []) {
    const user = await createUser(env.tx, u);
    note("users", { id: user.username, name: user.username });
  }
  for (const g of body.groups ?? []) {
    await env.tx.query("INSERT INTO groups (name, members, escalation_policy) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET members = EXCLUDED.members, escalation_policy = EXCLUDED.escalation_policy", [g.name, g.members ?? [], g.escalation_policy ?? null]);
    note("groups", { id: g.name, name: g.name });
  }
  await refreshWorld(env);
  for (const [key, kind] of CONFIG_KINDS.slice(0, 2)) await configFixtures(env, body, key, kind, note);
  for (const ci of body.cis ?? []) {
    const made = await createCi(env, ci as never);
    note("cis", { id: made.id, name: made.name });
  }
  await refreshWorld(env);
  for (const r of body.relationships ?? []) {
    await addRelationship(env, r);
    note("relationships", { id: `${String(r.source)}|${String(r.type)}|${String(r.target)}`, name: String(r.source) });
  }
  for (const m of body.maintenance ?? []) {
    if (!env.world.cis.has(String(m.ci))) validation(`Unknown item "${String(m.ci)}".`);
    await env.tx.query("INSERT INTO maintenance (ci, start_at, end_at) VALUES ($1, $2, $3)", [m.ci, new Date(String(m.start)).toISOString(), new Date(String(m.end)).toISOString()]);
    note("maintenance", { id: String(m.ci), name: String(m.ci) });
  }
  for (const r of body.rotations ?? []) note("rotations", { id: (await createRotation(env, r)).name, name: String(r.name) });
  for (const o of body.overrides ?? []) {
    await createOverride(env, String(o.rotation), o);
    note("overrides", { id: String(o.rotation), name: String(o.username) });
  }
  for (const p of body.escalation_policies ?? []) note("escalation_policies", { id: String(p.name), name: String(p.name) });
  for (const p of body.escalation_policies ?? []) await createPolicy(env, p as never);
  await refreshWorld(env);
  for (const [key, kind] of CONFIG_KINDS.slice(2)) await configFixtures(env, body, key, kind, note);
  for (const item of body.workflows ?? []) note("workflows", await workflowFixture(env, item));
  for (const g of body.guides ?? []) {
    await env.tx.query("INSERT INTO guides (id, name, questions, rules) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, questions = EXCLUDED.questions, rules = EXCLUDED.rules", [g.id, g.name, JSON.stringify(g.questions ?? []), JSON.stringify(g.rules ?? [])]);
    note("guides", { id: String(g.id), name: String(g.name) });
  }
  for (const b of body.boards ?? []) note("boards", { id: (await saveBoard(env, b, String(b.name))).name, name: String(b.name) });
  for (const f of body.freeze_windows ?? []) {
    await createFreeze(env, f);
    note("freeze_windows", { id: String(f.name), name: String(f.name) });
  }
  for (const d of body.delegations ?? []) {
    await env.tx.query("UPDATE users SET delegate = $2 WHERE username = $1", [d.member, JSON.stringify({ delegate: d.delegate, from: d.from, to: d.to })]);
    note("delegations", { id: String(d.member), name: String(d.member) });
  }
  for (const r of body.records ?? []) {
    const table = r.table as never;
    const fields = { ...(r.fields as Record<string, Value>) } as Record<string, Value>;
    if (typeof r.parent === "string") fields.parent = r.parent;
    if (typeof r.problem === "string") fields.problem = r.problem;
    const createdAt = typeof r.created_at === "string" ? new Date(r.created_at).toISOString() : undefined;
    const history = Array.isArray(r.state_history) ? (r.state_history as Array<{ state: string; at: string }>).map((h): StateEntry => ({ state: h.state, at: new Date(h.at).toISOString() })) : undefined;
    const rec = await save(env, {
      table,
      number: null,
      submitted: Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value }])),
      system: true,
      fixture: { createdAt, createdBy: typeof r.created_by === "string" ? r.created_by : "oona", history, state: typeof r.state === "string" ? r.state : undefined },
    });
    note("records", { id: rec.number, number: rec.number });
  }
  for (const v of body.votes ?? []) {
    const steps = await env.tx.query("SELECT 1 FROM change_steps WHERE change_number = $1 AND step_no = $2", [v.change, v.step]);
    if (steps.length === 0) validation(`No step ${String(v.step)} on ${String(v.change)}.`);
    await env.tx.query("INSERT INTO votes (change_number, step_no, voter, voted_by, decision, at) VALUES ($1, $2, $3, $4, $5, $6)", [v.change, v.step, v.on_behalf_of ?? v.username, v.username, v.decision, new Date(String(v.at)).toISOString()]);
    note("votes", { id: String(v.change), name: String(v.username) });
  }
  for (const a of body.knowledge_articles ?? []) note("knowledge_articles", await createArticleFixture(env, a));
  for (const d of body.dashboards ?? []) {
    await env.tx.query("INSERT INTO dashboards (id, name, roles, widgets) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, roles = EXCLUDED.roles, widgets = EXCLUDED.widgets", [d.id, d.name, d.roles ?? [], JSON.stringify(d.widgets ?? [])]);
    note("dashboards", { id: String(d.id), name: String(d.name) });
  }
  return created;
}

async function refreshWorld(env: Env): Promise<void> {
  const fresh = await World.load(env.tx);
  env.world.people = fresh.people;
  env.world.cis = fresh.cis;
  env.world.groups = fresh.groups;
  env.world.departmentNames = fresh.departmentNames;
}

async function configFixtures(env: Env, body: Fixtures, key: keyof Fixtures, kind: ConfigKind, note: (kind: string, entry: Record<string, unknown>) => void): Promise<void> {
  for (const item of (body[key] as Item[] | undefined) ?? []) {
    const saved = await saveConfig(env, kind, item, workspaceOf(item));
    note(String(key), { id: saved.id, name: String((saved.content as { name: string }).name) });
  }
}

/** A workflow whose `published` step lists become versions 1, 2 and onward; a null draft copies the last published steps. */
async function workflowFixture(env: Env, item: Item): Promise<Record<string, unknown>> {
  const published = Array.isArray(item.published) ? (item.published as unknown[][]) : [];
  const draft = Array.isArray(item.draft) ? item.draft : (published[published.length - 1] ?? []);
  const saved = await saveConfig(env, "workflow", { ...item, kind: item.kind ?? "flow", draft }, workspaceOf(item));
  for (const [index, steps] of published.entries()) {
    await env.tx.query("INSERT INTO workflow_versions (workflow_id, version, steps) VALUES ($1, $2, $3)", [saved.id, index + 1, JSON.stringify(steps)]);
  }
  return { id: saved.id, name: String((saved.content as { name: string }).name) };
}

route("POST", "/api/grading/reset", async () => {
  await transaction(async (tx) => {
    const tables = await tx.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    await tx.query(`TRUNCATE ${tables.map((t) => `"${t.tablename as string}"`).join(", ")} RESTART IDENTITY`);
  });
  resetSettings();
  resetClock();
  resetSlaCaches();
  forgetRateLimits();
  await setEndpoint(null);
  if (isAvailable()) await deleteAllObjects();
  await seedIfEmpty();
  return reply(200, { status: "reset" });
}, { public: true });

route("POST", "/api/grading/clock", async (ctx) => {
  const body = ctx.json<{ set?: string; advance_seconds?: number }>();
  let target: number;
  if (typeof body.set === "string" && !Number.isNaN(Date.parse(body.set))) target = await moveClock({ set: Date.parse(body.set) });
  else if (typeof body.advance_seconds === "number") target = await moveClock({ advance: body.advance_seconds });
  else return validation("Send set or advance_seconds.", { set: "Give an ISO 8601 instant or advance_seconds." });
  return reply(200, { server_time: new Date(target).toISOString() });
}, { public: true });

route("POST", "/api/grading/fixtures", async (ctx) => {
  const body = ctx.json<Fixtures>();
  const created = await transaction(async (tx) => createFixtures(await Env.create(tx, SYSTEM), body)).catch((error: unknown) => {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^2[23]/.test(code)) return validation("A fixture member is missing or malformed. Nothing was created.");
    throw error;
  });
  return reply(201, { created });
}, { public: true });

route("POST", "/api/grading/records/:number/save", async (ctx) => {
  const body = ctx.json<{ as?: string; fields?: Record<string, { value: Value; version?: number }> }>();
  const user = typeof body.as === "string" ? await loadUser(body.as) : null;
  if (!user) return notFound();
  const principal: Principal = { user, actor: user.username, actingFor: null };
  const record = await transaction(async (tx) => {
    const env = await Env.create(tx, principal);
    const existing = (await tx.query("SELECT table_name FROM records WHERE number = $1", [ctx.params.number]))[0];
    if (!existing) return notFound();
    const saved = await save(env, { table: existing.table_name as never, number: ctx.params.number!, submitted: body.fields ?? {} });
    return recordView(env, saved);
  });
  return reply(200, { record });
}, { public: true });

route("POST", "/api/grading/session", async (ctx) => {
  const body = ctx.json<{ username?: string }>();
  const user = typeof body.username === "string" ? await loadUser(body.username) : null;
  if (!user) return notFound();
  return reply(200, { user }, { "set-cookie": sessionCookie(await startSession(user.username)) });
}, { public: true });

route("PUT", "/api/grading/settings", async (ctx) => {
  const body = ctx.json<Record<string, string | number>>();
  for (const [name, value] of Object.entries(body)) {
    if (!isSettingName(name)) return fail(422, "validation", `Unknown setting "${name}".`);
    applySetting(name, value);
  }
  return reply(200, { settings: Object.fromEntries(SETTING_NAMES.map((n) => [n, settings[n]])) });
}, { public: true });

route("POST", "/api/grading/storage", async (ctx) => {
  const body = ctx.json<{ endpoint?: string | null }>();
  return reply(200, { endpoint: await setEndpoint(typeof body.endpoint === "string" ? body.endpoint : null) });
}, { public: true });
