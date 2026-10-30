import type { Route, Ctx } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { errors, validationError } from "../errors.js";
import { hashPassword } from "../config.js";
import { auditJson } from "../services/shapes.js";


const ROLES = ["visitor", "group_booker", "artist", "curator", "box_office", "finance", "admin"];
const VENUE_ID_RE = /^[a-z0-9-]+$/;

export function adminRoutes(): Route[] {
  const staff: Route = {
    method: "GET",
    pattern: "/api/admin/staff",
    roles: "admin",
    bodyLimit: "none",
    async handler() {
      const res = await query("select * from users order by id");
      return {
        status: 200,
        body: {
          users: res.rows.map((u) => ({
            id: Number(u.id),
            email: String(u.email),
            name: String(u.name),
            role: String(u.role),
            organisation_id: u.organisation_id === null || u.organisation_id === undefined ? null : String(u.organisation_id),
          })),
        },
      };
    },
  };

  const addStaff: Route = {
    method: "POST",
    pattern: "/api/admin/staff",
    roles: "admin",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "");
      const organisationId = body.organisation_id === null || body.organisation_id === undefined ? null : String(body.organisation_id);
      const problems: Record<string, string> = {};
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.email = "invalid";
      if (name.length === 0) problems.name = "invalid";
      if (password.length < 10 || password.length > 200) problems.password = "invalid";
      if (!ROLES.includes(role)) problems.role = "unknown";
      if (role === "group_booker" && organisationId === null) problems.organisation_id = "required";
      if (Object.keys(problems).length > 0) throw validationError(problems);
      const existing = await query("select 1 from users where email = $1", [email]);
      if (existing.rows.length > 0) throw errors.conflict("email_taken");
      const created = await withTransaction(async (client) => {
        const res = await client.query(
          "insert into users (name, email, password_hash, role, organisation_id) values ($1,$2,$3,$4,$5) returning *",
          [name, email, hashPassword(password), role, organisationId],
        );
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'staff_added','user',$3)",
          [ctx.user!.email, ctx.user!.role, email],
        );
        return res.rows[0];
      });
      return {
        status: 201,
        body: {
          id: Number(created.id),
          email: String(created.email),
          name: String(created.name),
          role: String(created.role),
          organisation_id: created.organisation_id === null || created.organisation_id === undefined ? null : String(created.organisation_id),
        },
      };
    },
  };

  const updateStaff: Route = {
    method: "PATCH",
    pattern: "/api/admin/staff/:id",
    roles: "admin",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const role = body.role === undefined ? undefined : String(body.role);
      const organisationId = body.organisation_id === undefined ? undefined : body.organisation_id === null ? null : String(body.organisation_id);
      const targetRes = await query("select * from users where id = $1", [Number(ctx.params.id)]);
      const target = targetRes.rows[0];
      if (!target) throw errors.notFound();
      const newRole = role ?? String(target.role);
      if (role !== undefined && !ROLES.includes(newRole)) throw validationError({ role: "unknown" });
      if (newRole === "group_booker" && (organisationId ?? target.organisation_id) === null) {
        throw validationError({ organisation_id: "required" });
      }
      // An admin can't change the role of the last remaining admin.
      if (String(target.role) === "admin" && newRole !== "admin") {
        const admins = await query("select count(*) as n from users where role = 'admin'");
        if (Number(admins.rows[0].n) <= 1) throw errors.conflict("last_admin");
      }
      const newOrg = organisationId === undefined ? target.organisation_id : organisationId;
      await withTransaction(async (client) => {
        await client.query("update users set role = $2, organisation_id = $3 where id = $1", [
          Number(target.id),
          newRole,
          newRole === "group_booker" ? newOrg : null,
        ]);
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,'staff_updated','user',$3,$4)",
          [ctx.user!.email, ctx.user!.role, String(target.email), `role=${newRole}`],
        );
      });
      const after = (await query("select * from users where id = $1", [Number(target.id)])).rows[0];
      return {
        status: 200,
        body: {
          id: Number(after.id),
          email: String(after.email),
          name: String(after.name),
          role: String(after.role),
          organisation_id: after.organisation_id === null || after.organisation_id === undefined ? null : String(after.organisation_id),
        },
      };
    },
  };

  const venues: Route = {
    method: "GET",
    pattern: "/api/admin/venues",
    roles: "admin",
    bodyLimit: "none",
    async handler() {
      const res = await query("select * from venues order by id");
      return { status: 200, body: { venues: res.rows.map((v) => ({ id: String(v.id), name: String(v.name) })) } };
    },
  };

  const addVenue: Route = {
    method: "POST",
    pattern: "/api/admin/venues",
    roles: "admin",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const id = String(body.id ?? "").trim();
      const name = String(body.name ?? "").trim();
      const problems: Record<string, string> = {};
      if (!VENUE_ID_RE.test(id)) problems.id = "invalid";
      if (name.length === 0) problems.name = "invalid";
      if (Object.keys(problems).length > 0) throw validationError(problems);
      const existing = await query("select 1 from venues where id = $1", [id]);
      if (existing.rows.length > 0) throw errors.conflict("venue_exists");
      await withTransaction(async (client) => {
        await client.query("insert into venues (id, name) values ($1,$2)", [id, name]);
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'venue_added','venue',$3)",
          [ctx.user!.email, ctx.user!.role, id],
        );
      });
      return { status: 201, body: { id, name } };
    },
  };

  const updateVenue: Route = {
    method: "PATCH",
    pattern: "/api/admin/venues/:id",
    roles: "admin",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const name = String(body.name ?? "").trim();
      if (name.length === 0) throw validationError({ name: "invalid" });
      const res = await query("select * from venues where id = $1", [ctx.params.id]);
      if (res.rows.length === 0) throw errors.notFound();
      await withTransaction(async (client) => {
        await client.query("update venues set name = $2 where id = $1", [ctx.params.id, name]);
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'venue_updated','venue',$3)",
          [ctx.user!.email, ctx.user!.role, ctx.params.id],
        );
      });
      return { status: 200, body: { id: ctx.params.id, name } };
    },
  };

  const edition: Route = {
    method: "GET",
    pattern: "/api/admin/edition",
    roles: "admin",
    bodyLimit: "none",
    async handler() {
      const res = await query("select * from edition where id = 1");
      const e = res.rows[0];
      return { status: 200, body: { name: String(e.name), first_day: String(e.first_day), last_day: String(e.last_day) } };
    },
  };

  const saveEdition: Route = {
    method: "PUT",
    pattern: "/api/admin/edition",
    roles: "admin",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const name = String(body.name ?? "").trim();
      const firstDay = String(body.first_day ?? "").trim();
      const lastDay = String(body.last_day ?? "").trim();
      const problems: Record<string, string> = {};
      if (name.length === 0) problems.name = "invalid";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) problems.first_day = "invalid";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) problems.last_day = "invalid";
      if (!problems.first_day && !problems.last_day && lastDay < firstDay) problems.last_day = "before_first_day";
      if (Object.keys(problems).length > 0) throw validationError(problems);
      const outside = await query(
        "select count(*) as n from sessions where festival_day < $1 or festival_day > $2",
        [firstDay, lastDay],
      );
      if (Number(outside.rows[0].n) > 0) throw errors.conflict("sessions_outside_edition");
      await withTransaction(async (client) => {
        await client.query("update edition set name = $2, first_day = $3, last_day = $4 where id = 1", [1, name, firstDay, lastDay]);
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'edition_saved','edition','1')",
          [ctx.user!.email, ctx.user!.role],
        );
      });
      return { status: 200, body: { name, first_day: firstDay, last_day: lastDay } };
    },
  };

  const pricePolicy: Route = {
    method: "GET",
    pattern: "/api/admin/price-policy",
    roles: "admin",
    bodyLimit: "none",
    async handler() {
      const res = await query("select * from price_policy where id = 1");
      const p = res.rows[0];
      return {
        status: 200,
        body: {
          full_festival_full_cents: Number(p.full_festival_full_cents),
          full_festival_reduced_cents: Number(p.full_festival_reduced_cents),
          day_full_cents: Number(p.day_full_cents),
          day_reduced_cents: Number(p.day_reduced_cents),
          group_discount_percent: Number(p.group_discount_percent),
          version: Number(p.version),
        },
      };
    },
  };

  const savePricePolicy: Route = {
    method: "PUT",
    pattern: "/api/admin/price-policy",
    roles: "admin",
    bodyLimit: "json",
    async handler(ctx) {
      const res = await query("select * from price_policy where id = 1");
      const current = res.rows[0];
      const ifMatch = ctx.req.headers["if-match"];
      if (ifMatch === undefined) throw errors.versionRequired();
      const version = Number(ifMatch);
      if (version !== Number(current.version)) throw errors.staleVersion(Number(current.version));
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const policy = {
        full_festival_full_cents: Number(body.full_festival_full_cents ?? current.full_festival_full_cents),
        full_festival_reduced_cents: Number(body.full_festival_reduced_cents ?? current.full_festival_reduced_cents),
        day_full_cents: Number(body.day_full_cents ?? current.day_full_cents),
        day_reduced_cents: Number(body.day_reduced_cents ?? current.day_reduced_cents),
        group_discount_percent: Number(body.group_discount_percent ?? current.group_discount_percent),
      };
      const problems: Record<string, string> = {};
      for (const key of ["full_festival_full_cents", "full_festival_reduced_cents", "day_full_cents", "day_reduced_cents"]) {
        const value = policy[key as keyof typeof policy];
        if (!Number.isInteger(value) || value < 0 || value > 100000) problems[key] = "invalid";
      }
      if (!Number.isInteger(policy.group_discount_percent) || policy.group_discount_percent < 0 || policy.group_discount_percent > 50) {
        problems.group_discount_percent = "invalid";
      }
      if (Object.keys(problems).length > 0) throw validationError(problems);
      await withTransaction(async (client) => {
        await client.query(
          `update price_policy set full_festival_full_cents = $2, full_festival_reduced_cents = $3,
             day_full_cents = $4, day_reduced_cents = $5, group_discount_percent = $6, version = version + 1
           where id = 1`,
          [
            1,
            policy.full_festival_full_cents,
            policy.full_festival_reduced_cents,
            policy.day_full_cents,
            policy.day_reduced_cents,
            policy.group_discount_percent,
          ],
        );
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'price_policy_saved','price_policy','1')",
          [ctx.user!.email, ctx.user!.role],
        );
      });
      const after = (await query("select * from price_policy where id = 1")).rows[0];
      return {
        status: 200,
        body: {
          full_festival_full_cents: Number(after.full_festival_full_cents),
          full_festival_reduced_cents: Number(after.full_festival_reduced_cents),
          day_full_cents: Number(after.day_full_cents),
          day_reduced_cents: Number(after.day_reduced_cents),
          group_discount_percent: Number(after.group_discount_percent),
          version: Number(after.version),
        },
      };
    },
  };

  const auditTrail: Route = {
    method: "GET",
    pattern: "/api/admin/audit",
    roles: ["admin", "finance"],
    bodyLimit: "none",
    async handler(ctx) {
      const targetId = ctx.query.get("target_id");
      const limitRaw = ctx.query.get("limit");
      const limit = limitRaw !== null && Number.isInteger(Number(limitRaw)) && Number(limitRaw) > 0 ? Number(limitRaw) : 100;
      const res = await query(
        targetId
          ? "select * from audit where target_id = $1 order by at desc, id desc limit $2"
          : "select * from audit order by at desc, id desc limit $1",
        targetId ? [targetId, limit] : [limit],
      );
      return { status: 200, body: { entries: res.rows.map((row: Row) => auditJson(row)) } };
    },
  };

  return [staff, addStaff, updateStaff, venues, addVenue, updateVenue, edition, saveEdition, pricePolicy, savePricePolicy, auditTrail];
}
