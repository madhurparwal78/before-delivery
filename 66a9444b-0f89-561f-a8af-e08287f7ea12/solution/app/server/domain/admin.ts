// Admins run staff roles, venues, edition dates and the price policy.
import { ROLES, hashPassword, type Role, type User } from "../auth.ts";
import { db, transaction } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import { passwordError, userView } from "./accounts.ts";
import { audit } from "./audit.ts";
import { newId } from "./ids.ts";
import { edition, withinEdition } from "./programme.ts";
import { asObject, check, email, intOrNull, text } from "./validate.ts";

const ADMIN = ["admin"] as const;

route("GET", "/api/admin/staff", ADMIN, async () => {
  const users = await db.all<User>("SELECT id, email, name, role, organisation_id FROM users WHERE role <> 'visitor' ORDER BY role, name");
  return ok({ users: users.map(userView) });
});

async function organisationFor(role: Role, value: unknown): Promise<string | null> {
  if (role !== "group_booker") return null;
  if (typeof value !== "string" || !value) throw new FieldErrors({ organisation_id: "required" });
  if (!(await db.one("SELECT id FROM organisations WHERE id = $1", [value]))) throw notFound();
  return value;
}

const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

route("POST", "/api/admin/staff", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const address = email(body.email);
  if (address && (await db.one("SELECT 1 FROM users WHERE email = $1", [address]))) throw new ApiError(409, "email_taken");
  const errors: Record<string, string> = {};
  const name = text(body.name, 1, 200);
  if (!name) errors.name = "required";
  if (!address) errors.email = "invalid";
  const bad = passwordError(body.password);
  if (bad) errors.password = bad;
  if (!isRole(body.role)) errors.role = "unknown";
  check(errors);
  const role = body.role as Role;
  const organisation = await organisationFor(role, body.organisation_id);
  const user: User = { id: newId(), email: address!, name: name!, role, organisation_id: organisation };
  await transaction(async (tx) => {
    await tx.query("INSERT INTO users (id, email, name, password_hash, role, organisation_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [user.id, user.email, user.name, await hashPassword(body.password as string), role, organisation]);
    await audit(tx, ctx.user, "staff.added", { type: "user", id: user.id }, { email: user.email, role });
  });
  return ok(userView(user), 201);
});

route("PATCH", "/api/admin/staff/:id", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const updated = await transaction(async (tx) => {
    await tx.query("SELECT id FROM users WHERE role = 'admin' FOR UPDATE");
    const user = await tx.one<User>("SELECT id, email, name, role, organisation_id FROM users WHERE id = $1", [ctx.params.id!]);
    if (!user) throw notFound();
    const admins = (await tx.one<{ n: number }>("SELECT count(*)::integer AS n FROM users WHERE role = 'admin'"))!.n;
    if (user.role === "admin" && body.role !== "admin" && admins <= 1) throw new ApiError(409, "last_admin");
    if (!isRole(body.role)) throw new FieldErrors({ role: "unknown" });
    const organisation = await organisationFor(body.role, body.organisation_id);
    await tx.query("UPDATE users SET role = $2, organisation_id = $3 WHERE id = $1", [user.id, body.role, organisation]);
    await audit(tx, ctx.user, "staff.role_changed", { type: "user", id: user.id }, { from: user.role, to: body.role });
    return { ...user, role: body.role, organisation_id: organisation };
  });
  return ok(userView(updated));
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

route("GET", "/api/admin/venues", ADMIN, async () => ok({ venues: await db.all("SELECT id, name FROM venues ORDER BY position, id") }));

route("POST", "/api/admin/venues", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (SLUG_RE.test(id) && (await db.one("SELECT 1 FROM venues WHERE id = $1", [id]))) throw new ApiError(409, "venue_exists");
  const name = text(body.name, 1, 200);
  const errors: Record<string, string> = {};
  if (!SLUG_RE.test(id) || id.length > 60) errors.id = "invalid";
  if (!name) errors.name = "required";
  check(errors);
  await transaction(async (tx) => {
    await tx.query("INSERT INTO venues (id, name, position) VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM venues))", [id, name]);
    await audit(tx, ctx.user, "venue.added", { type: "venue", id }, { name });
  });
  return ok({ id, name }, 201);
});

route("PATCH", "/api/admin/venues/:id", ADMIN, async (ctx) => {
  const name = text(asObject(ctx.body).name, 1, 200);
  const venue = await transaction(async (tx) => {
    const row = await tx.one<{ id: string }>("SELECT id FROM venues WHERE id = $1 FOR UPDATE", [ctx.params.id!]);
    if (!row) throw notFound();
    if (!name) throw new FieldErrors({ name: "required" });
    await tx.query("UPDATE venues SET name = $2 WHERE id = $1", [row.id, name]);
    await audit(tx, ctx.user, "venue.renamed", { type: "venue", id: row.id }, { name });
    return { id: row.id, name };
  });
  return ok(venue);
});

route("GET", "/api/admin/edition", ADMIN, async () => ok(await edition()));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

route("PUT", "/api/admin/edition", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const saved = await transaction(async (tx) => {
    const current = await edition(tx);
    const next = {
      name: text(body.name, 1, 200) ?? current.name,
      first_day: typeof body.first_day === "string" && DATE_RE.test(body.first_day) ? body.first_day : null,
      last_day: typeof body.last_day === "string" && DATE_RE.test(body.last_day) ? body.last_day : null,
    };
    if (next.first_day && next.last_day) {
      const sessions = await tx.all<{ starts_at: Date }>("SELECT starts_at FROM sessions");
      if (sessions.some((s) => !withinEdition({ ...next, first_day: next.first_day!, last_day: next.last_day! }, s.starts_at))) {
        throw new ApiError(409, "sessions_outside_edition");
      }
    }
    const errors: Record<string, string> = {};
    if (!next.first_day) errors.first_day = "invalid";
    if (!next.last_day) errors.last_day = "invalid";
    else if (next.first_day && next.last_day < next.first_day) errors.last_day = "before_first_day";
    check(errors);
    await tx.query("UPDATE edition SET name = $1, first_day = $2, last_day = $3 WHERE id = 1", [next.name, next.first_day, next.last_day]);
    await audit(tx, ctx.user, "edition.saved", { type: "edition", id: "1" }, next);
    return next;
  });
  return ok(saved);
});

const POLICY_FIELDS = ["full_festival_full_cents", "full_festival_reduced_cents", "day_full_cents", "day_reduced_cents", "group_discount_percent"] as const;

route("GET", "/api/admin/price-policy", ADMIN, async () => ok(await db.one(`SELECT ${POLICY_FIELDS.join(", ")}, version FROM price_policy WHERE id = 1`)));

route("PUT", "/api/admin/price-policy", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const saved = await transaction(async (tx) => {
    const current = (await tx.one<{ version: number }>("SELECT version FROM price_policy WHERE id = 1 FOR UPDATE"))!;
    const ifMatch = ctx.headers["if-match"];
    if (typeof ifMatch !== "string" || !ifMatch.trim()) throw new ApiError(428, "version_required");
    if (Number(ifMatch.replace(/"/g, "")) !== current.version) throw new ApiError(412, "stale_version", { current_version: current.version });
    const errors: Record<string, string> = {};
    const values = POLICY_FIELDS.map((field) => {
      const value = intOrNull(body[field]);
      const max = field === "group_discount_percent" ? 50 : 100000;
      if (value === null || value < 0 || value > max) errors[field] = "out_of_range";
      return value;
    });
    check(errors);
    const row = await tx.one(
      `UPDATE price_policy SET ${POLICY_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(", ")}, version = version + 1 WHERE id = 1
       RETURNING ${POLICY_FIELDS.join(", ")}, version`, values);
    await audit(tx, ctx.user, "price_policy.saved", { type: "price_policy", id: "1" }, Object.fromEntries(POLICY_FIELDS.map((f, i) => [f, values[i]])));
    return row;
  });
  return ok(saved);
});
