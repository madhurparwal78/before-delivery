import { ROLES } from "../../shared/types.js";
import { hashPassword, loadUser, startSession, verifyPassword } from "../auth.js";
import { nowDate } from "../clock.js";
import { settings } from "../config.js";
import { lockKey, query, transaction, type Tx } from "../db.js";
import { fail, notFound, operatorOnly, forbidden, validation } from "../errors.js";
import { clearedCookie, rateCheck, reply, requireOperator, requireRole, requireSession, route, sessionCookie, withEnv } from "../http.js";
import { publishTo } from "../live.js";
import { isAvailable } from "../storage.js";
import { queuedCount } from "../files.js";
import { isValidZone } from "../../shared/tz.js";
import { configList, configPut } from "../store.js";
import { captureChange } from "../configsets.js";
import { inboxRuleName, type InboxRule } from "../inbox.js";

interface UserRow {
  username: string;
  display_name: string;
  roles: string[];
  department: string;
  time_zone: string;
  out_of_office: boolean;
  capacity: number | null;
  active: boolean;
  delegate: { delegate: string; from: string; to: string } | null;
}

const USER_SQL = `SELECT p.username, p.display_name, p.department, p.active, u.roles, u.time_zone, u.out_of_office, u.capacity, u.delegate
  FROM people p JOIN users u ON u.username = p.username`;

function userJson(r: Record<string, unknown>): UserRow {
  return {
    username: r.username as string,
    display_name: r.display_name as string,
    roles: r.roles as string[],
    department: r.department as string,
    time_zone: r.time_zone as string,
    out_of_office: r.out_of_office as boolean,
    capacity: (r.capacity as number | null) ?? null,
    active: r.active as boolean,
    delegate: (r.delegate as UserRow["delegate"]) ?? null,
  };
}

export async function createUser(tx: Tx, body: Record<string, unknown>): Promise<UserRow> {
  const errors: Record<string, string> = {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!/^[a-z0-9._-]+$/.test(username)) errors.username = "Username is required: lowercase letters, digits, dots, dashes.";
  if (typeof body.password !== "string" || body.password === "") errors.password = "Password is required.";
  if (typeof body.display_name !== "string" || body.display_name === "") errors.display_name = "Display name is required.";
  const roles = Array.isArray(body.roles) ? (body.roles as string[]) : [];
  if (roles.length === 0 || roles.some((r) => !(ROLES as readonly string[]).includes(r))) errors.roles = "Choose at least one of the five roles.";
  const zone = typeof body.time_zone === "string" ? body.time_zone : "Europe/Berlin";
  if (!isValidZone(zone)) errors.time_zone = "Use an IANA time zone such as Europe/Berlin.";
  const department = typeof body.department === "string" ? body.department : "";
  if (!(await tx.query("SELECT 1 FROM departments WHERE name = $1", [department])).length) errors.department = `Department "${department}" does not exist.`;
  if (username) await lockKey(tx, `user:${username}`);
  if (username && (await tx.query("SELECT 1 FROM people WHERE username = $1", [username])).length) errors.username = "That username is taken.";
  if (Object.keys(errors).length > 0) validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
  const hash = await hashPassword(body.password as string);
  await tx.query("INSERT INTO people (username, display_name, department, active) VALUES ($1, $2, $3, $4)", [username, body.display_name, department, body.active !== false]);
  await tx.query("INSERT INTO users (username, password_hash, roles, time_zone, out_of_office, capacity) VALUES ($1, $2, $3, $4, $5, $6)", [username, hash, roles, zone, body.out_of_office === true, typeof body.capacity === "number" ? body.capacity : null]);
  return userJson((await tx.query(`${USER_SQL} WHERE p.username = $1`, [username]))[0]!);
}

route("GET", "/api/health", async () => reply(200, { status: isAvailable() ? "ok" : "unavailable" }), { public: true });

route(
  "POST",
  "/api/session",
  async (ctx) => {
    const body = ctx.json<{ username?: unknown; password?: unknown }>();
    rateCheck(`login:${typeof body.username === "string" ? body.username : ""}`, settings.LOGIN_RATE_LIMIT_PER_MINUTE);
    const row = typeof body.username === "string" ? (await query("SELECT password_hash FROM users WHERE username = $1", [body.username]))[0] : undefined;
    const user = row && typeof body.password === "string" && (await verifyPassword(body.password, row.password_hash as string)) ? await loadUser(body.username as string) : null;
    if (!user) fail(401, "bad_credentials", "That username and password do not match.");
    return reply(200, { user }, { "set-cookie": sessionCookie(await startSession(user.username)) });
  },
  { public: true },
);

route("GET", "/api/session", async (ctx) => {
  const s = requireSession(ctx);
  return reply(200, { user: s.user, workspace: s.workspace, impersonating: s.impersonating });
});

route("DELETE", "/api/session", async (ctx) => {
  requireSession(ctx);
  await query("DELETE FROM sessions WHERE token = $1", [ctx.cookieToken]);
  return reply(204, undefined, { "set-cookie": clearedCookie() });
});

route("PUT", "/api/session/workspace", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const body = ctx.json<{ workspace?: unknown }>();
    if (body.workspace !== "live" && body.workspace !== "test") return validation("Workspace must be live or test.", { workspace: "Choose live or test." });
    await env.tx.query("UPDATE sessions SET workspace = $2 WHERE token = $1", [ctx.cookieToken, body.workspace]);
    return reply(200, { workspace: body.workspace });
  }),
);

route("POST", "/api/impersonate", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const body = ctx.json<{ username?: unknown }>();
    const target = typeof body.username === "string" ? await loadUser(body.username) : null;
    if (!target) return notFound();
    await env.tx.query("UPDATE sessions SET impersonating = $2 WHERE token = $1", [ctx.cookieToken, target.username]);
    await env.tx.query("INSERT INTO audit_log (at, kind, actor, target) VALUES ($1, 'impersonation_started', $2, $3)", [nowDate().toISOString(), env.who.actor, target.username]);
    return reply(200, { impersonating: { username: target.username, display_name: target.display_name } });
  }),
);

route("DELETE", "/api/impersonate", async (ctx) => {
  const session = requireSession(ctx);
  if (!session.actor.roles.includes("operator")) return operatorOnly();
  if (!session.impersonating) return validation("You are not impersonating anyone.");
  await transaction(async (tx) => {
    await tx.query("UPDATE sessions SET impersonating = NULL WHERE token = $1", [ctx.cookieToken]);
    await tx.query("INSERT INTO audit_log (at, kind, actor, target) VALUES ($1, 'impersonation_stopped', $2, $3)", [nowDate().toISOString(), session.actor.username, session.impersonating!.username]);
  });
  return reply(204);
});

route("GET", "/api/audit-log", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const kind = ctx.query.get("kind");
    const rows = await env.tx.query("SELECT at, kind, actor, target FROM audit_log WHERE ($1::text IS NULL OR kind = $1) ORDER BY id DESC", [kind]);
    return reply(200, { entries: rows.map((r) => ({ at: r.at, kind: r.kind, actor: r.actor, target: r.target })) });
  }),
);

route("GET", "/api/users", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    const rows = await env.tx.query(`${USER_SQL} ORDER BY p.seq`);
    return reply(200, { users: rows.map(userJson) });
  }),
);

route("POST", "/api/users", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { user: await createUser(env.tx, ctx.json()) });
  }),
);

route("PATCH", "/api/users/:username", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const username = ctx.params.username!;
    const body = ctx.json<Record<string, unknown>>();
    const current = (await env.tx.query(`${USER_SQL} WHERE p.username = $1`, [username]))[0];
    if (!current) return notFound();
    const errors: Record<string, string> = {};
    if (body.roles !== undefined && (!Array.isArray(body.roles) || body.roles.length === 0 || body.roles.some((r: string) => !(ROLES as readonly string[]).includes(r)))) errors.roles = "Choose at least one of the five roles.";
    if (body.time_zone !== undefined && !(typeof body.time_zone === "string" && isValidZone(body.time_zone))) errors.time_zone = "Use an IANA time zone such as Europe/Berlin.";
    if (body.department !== undefined && !(await env.tx.query("SELECT 1 FROM departments WHERE name = $1", [body.department])).length) errors.department = "Choose an existing department.";
    if (Object.keys(errors).length > 0) return validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
    await env.tx.query("UPDATE people SET display_name = COALESCE($2, display_name), department = COALESCE($3, department), active = COALESCE($4, active) WHERE username = $1", [username, body.display_name ?? null, body.department ?? null, body.active ?? null]);
    if (body.password !== undefined && typeof body.password === "string" && body.password !== "") await env.tx.query("UPDATE users SET password_hash = $2 WHERE username = $1", [username, await hashPassword(body.password)]);
    await env.tx.query(
      "UPDATE users SET roles = COALESCE($2, roles), time_zone = COALESCE($3, time_zone), out_of_office = COALESCE($4, out_of_office), capacity = CASE WHEN $5 THEN $6 ELSE capacity END WHERE username = $1",
      [username, body.roles ?? null, body.time_zone ?? null, body.out_of_office ?? null, "capacity" in body, typeof body.capacity === "number" ? body.capacity : null],
    );
    const fresh = userJson((await env.tx.query(`${USER_SQL} WHERE p.username = $1`, [username]))[0]!);
    const rolesChanged = body.roles !== undefined && JSON.stringify([...(current.roles as string[])].sort()) !== JSON.stringify([...fresh.roles].sort());
    env.tx.after.push(() => publishTo(username, "session", rolesChanged ? "access_changed" : "profile_changed", {}));
    return reply(200, { user: fresh });
  }),
);

route("PUT", "/api/users/:username/delegate", async (ctx) =>
  withEnv(ctx, async (env) => {
    const username = ctx.params.username!;
    if (env.user.username !== username && !env.user.roles.includes("operator")) return forbidden();
    const body = ctx.json<{ delegate?: string | null; from?: string; to?: string }>();
    if (!(await env.tx.query("SELECT 1 FROM users WHERE username = $1", [username])).length) return notFound();
    if (body.delegate === null) await env.tx.query("UPDATE users SET delegate = NULL WHERE username = $1", [username]);
    else {
      const errors: Record<string, string> = {};
      if (typeof body.delegate !== "string" || !(await env.tx.query("SELECT 1 FROM users WHERE username = $1", [body.delegate])).length) errors.delegate = "Choose an existing person.";
      if (typeof body.from !== "string" || Number.isNaN(Date.parse(body.from))) errors.from = "Give a start instant.";
      if (typeof body.to !== "string" || Number.isNaN(Date.parse(body.to)) || Date.parse(body.to) <= Date.parse(body.from ?? "")) errors.to = "The end must be after the start.";
      if (Object.keys(errors).length > 0) return validation("Check the delegation.", errors);
      await env.tx.query("UPDATE users SET delegate = $2 WHERE username = $1", [username, JSON.stringify({ delegate: body.delegate, from: body.from, to: body.to })]);
    }
    const row = (await env.tx.query(`${USER_SQL} WHERE p.username = $1`, [username]))[0]!;
    return reply(200, { user: userJson(row) });
  }),
);

route("GET", "/api/groups", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    const rows = await env.tx.query("SELECT name, members, escalation_policy FROM groups ORDER BY seq");
    return reply(200, { groups: rows.map((g) => ({ name: g.name, members: g.members, escalation_policy: g.escalation_policy })) });
  }),
);

async function saveGroup(body: Record<string, unknown>, name: string | null, create: boolean): Promise<Record<string, unknown>> {
  const groupName = name ?? (typeof body.name === "string" ? body.name : "");
  if (groupName === "") return validation("A group needs a name.", { name: "Name is required." });
  const members = Array.isArray(body.members) ? (body.members as string[]) : undefined;
  if (members) {
    const known = await query("SELECT username FROM users WHERE username = ANY($1)", [members]);
    if (known.length !== new Set(members).size) return validation("Every member must be an existing user.", { members: "Use existing usernames." });
  }
  const policy = body.escalation_policy;
  if (typeof policy === "string" && !(await query("SELECT 1 FROM escalation_policies WHERE name = $1", [policy])).length) return validation("Unknown escalation policy.", { escalation_policy: "Choose an existing policy." });
  if (create) {
    if ((await query("SELECT 1 FROM groups WHERE name = $1", [groupName])).length) return validation("That group exists.", { name: "A group with this name exists." });
    await query("INSERT INTO groups (name, members, escalation_policy) VALUES ($1, $2, $3)", [groupName, members ?? [], typeof policy === "string" ? policy : null]);
  } else {
    if (!(await query("SELECT 1 FROM groups WHERE name = $1", [groupName])).length) return notFound();
    await query("UPDATE groups SET members = COALESCE($2, members), escalation_policy = CASE WHEN $3 THEN $4 ELSE escalation_policy END WHERE name = $1", [groupName, members ?? null, "escalation_policy" in body, typeof policy === "string" ? policy : null]);
  }
  const row = (await query("SELECT name, members, escalation_policy FROM groups WHERE name = $1", [groupName]))[0]!;
  return { name: row.name, members: row.members, escalation_policy: row.escalation_policy };
}

route("POST", "/api/groups", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { group: await saveGroup(ctx.json(), null, true) });
  }),
);

route("PATCH", "/api/groups/:name", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { group: await saveGroup(ctx.json(), ctx.params.name!, false) });
  }),
);

route("GET", "/api/departments", async (ctx) => {
  requireSession(ctx);
  const rows = await query("SELECT d.name, (SELECT count(*)::int FROM people p WHERE p.department = d.name AND p.active) AS members FROM departments d ORDER BY d.name");
  return reply(200, { departments: rows.map((r) => ({ name: r.name, members: r.members })) });
});

route("GET", "/api/inbox", async (ctx) => {
  const s = requireSession(ctx);
  const rows = await query("SELECT id, event, text, record, at, read FROM inbox WHERE username = $1 AND delivered ORDER BY id DESC", [s.user.username]);
  const digest = (await query("SELECT digest FROM users WHERE username = $1", [s.user.username]))[0]?.digest;
  return reply(200, { items: rows.map((r) => ({ id: r.id, event: r.event, text: r.text, record: r.record, at: r.at, read: r.read })), unread: rows.filter((r) => !r.read).length, digest });
});

async function unreadOf(username: string): Promise<number> {
  return (await query("SELECT count(*)::int AS n FROM inbox WHERE username = $1 AND delivered AND NOT read", [username]))[0]!.n as number;
}

route("POST", "/api/inbox/read-all", async (ctx) => {
  const s = requireSession(ctx);
  await query("UPDATE inbox SET read = true WHERE username = $1", [s.user.username]);
  publishTo(s.user.username, "inbox", "item", {});
  return reply(200, { unread: 0 });
});

route("POST", "/api/inbox/:id/read", async (ctx) => {
  const s = requireSession(ctx);
  const rows = await query("UPDATE inbox SET read = true WHERE id = $1 AND username = $2 RETURNING id", [Number(ctx.params.id), s.user.username]);
  if (rows.length === 0) return notFound();
  publishTo(s.user.username, "inbox", "item", {});
  return reply(200, { unread: await unreadOf(s.user.username) });
});

route("PUT", "/api/inbox/settings", async (ctx) => {
  const s = requireSession(ctx);
  const body = ctx.json<{ digest?: unknown }>();
  if (body.digest !== "immediate" && body.digest !== "daily") return validation("Digest must be immediate or daily.", { digest: "Choose immediate or daily." });
  await query("UPDATE users SET digest = $2 WHERE username = $1", [s.user.username, body.digest]);
  return reply(200, { digest: body.digest });
});

route("GET", "/api/inbox-rules", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const workspace = ctx.session!.workspace;
    return reply(200, { rules: (await configList<InboxRule>("inbox_rule", workspace, env.tx)).map((r) => r.content) });
  }),
);

route("PUT", "/api/inbox-rules", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const workspace = ctx.session!.workspace;
    const body = ctx.json<{ rules?: Array<{ name?: string; event?: string; roles?: string[]; enabled?: boolean }> }>();
    if (!Array.isArray(body.rules)) return validation("Send the rules as a list.", { rules: "Rules must be a list." });
    const rules: InboxRule[] = [];
    const named = new Set(body.rules.flatMap((r) => (r.name ? [r.name] : [])));
    for (const r of body.rules) {
      const roles = Array.isArray(r.roles) ? r.roles : [];
      const rule = { event: String(r.event ?? ""), roles, enabled: r.enabled !== false };
      const name = r.name ? r.name : inboxRuleName(rule, named);
      named.add(name);
      rules.push({ name, ...rule });
    }
    const before = await configList<InboxRule>("inbox_rule", workspace, env.tx);
    await env.tx.query("DELETE FROM config_items WHERE workspace = $1 AND kind = 'inbox_rule'", [workspace]);
    for (const rule of rules) await configPut(env.tx, workspace, "inbox_rule", rule.name!, rule);
    if (workspace === "test") for (const name of new Set([...before.map((b) => b.name), ...rules.map((r) => r.name!)])) await captureChange(env, "inbox_rule", name);
    return reply(200, { rules });
  }),
);

route("GET", "/api/storage", async (ctx) => {
  requireSession(ctx);
  const queued = await transaction((tx) => queuedCount(tx));
  return reply(200, { storage: isAvailable() ? "available" : "unavailable", queued_uploads: queued });
});
