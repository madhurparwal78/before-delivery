/** Endpoints for sessions, accounts, boats, measurements, submissions, rule sets, authorities, standing and the audit trail. */
import { Ladder } from "./ladder.js";
import { nextCode, one, pool, rows, run, transaction } from "./db.js";
import { audit, auditPage } from "./audit.js";
import { accountByEmail, accountById, accountByIdentity, accountView, createAccount, liveAccountOfRole, normaliseEmail, refuseRoleChange, removeAccount, renameAccount } from "./accounts.js";
import { boatRow, boatViews, currentValue, dimensionOfMeasurement, dimensionState, insertMeasurement, type MeasurementRow } from "./boats.js";
import { stepBackDrawings } from "./drawings.js";
import { authorityRow, createAuthority, createRuleSet, listAuthorities, listRuleSets, updateRuleSet, withdrawAuthority } from "./admin.js";
import { boatScope, onlyRoles, visibleBoat } from "./access.js";
import { created, ifMatchRevision, ok, sailmakerEtag, SESSION_COOKIE, cookieValue, sessionCookies, clearedCookies, type Reply, type Route } from "./http.js";
import { decideMany, decideSubmission, createSubmission, listSubmissions, reverseSubmission, submissionRow } from "./submissions.js";
import { seasonsWithSubmissions, standingFor } from "./standing.js";
import { endSession, passwordGrant, refreshGrant, verifyToken, type Tokens } from "./identity.js";
import { openSession, sealSession } from "./session.js";
import { FieldErrors, invalid, notFound, refuse, storeUnavailable } from "./errors.js";
import { health } from "./lifecycle.js";
import { currentRuleSet } from "./rules.js";
import { getObject, putObject, sha256Hex, StoreUnavailable } from "./s3.js";
import { keysetPage, pageRequest } from "./paging.js";
import { now } from "./time.js";
import * as check from "./validate.js";
import { FIELD, ROLE_TABLE } from "../shared/copy.js";
import { DIMENSION_KEYS, type Role } from "../shared/types.js";
import { inLengthRange, looksLikeInches } from "../shared/units.js";

const EMAIL_PROBLEM = (email: string): boolean => {
  const at = email.split("@");
  if (at.length !== 2 || at[0]!.length < 1 || /\s/.test(email)) return true;
  const domain = at[1]!;
  const dot = domain.indexOf(".");
  return dot < 1 || domain.lastIndexOf(".") === domain.length - 1 || !domain.includes(".");
};

async function sessionBody(tokens: Tokens, failure: "bad_credentials" | "unauthenticated"): Promise<Reply> {
  const claims = await verifyToken(tokens.accessToken);
  const account = claims ? await accountByIdentity(pool, claims.sub) : null;
  if (!claims || !account) throw refuse(failure);
  const envelope = sealSession({ sub: claims.sub, refreshToken: tokens.refreshToken, expiresAt: Date.now() + tokens.refreshExpiresIn * 1000 });
  return {
    status: 200,
    json: { account: accountView(account), access_token: tokens.accessToken, expires_in: tokens.expiresIn },
    cookies: sessionCookies(envelope, tokens.refreshExpiresIn),
  };
}

export const peopleRoutes: Route[] = [
  {
    method: "GET", pattern: "/api/health", auth: "public", body: "none",
    handler: async () => {
      const result = await health();
      return { status: result.status, json: result.body };
    },
  },
  {
    method: "POST", pattern: "/api/session", auth: "public", body: "json",
    handler: async (ctx) => {
      const { email, password } = ctx.json();
      if (typeof email !== "string" || typeof password !== "string") throw refuse("bad_credentials");
      const tokens = await passwordGrant(normaliseEmail(email), password);
      if (!tokens) throw refuse("bad_credentials");
      return sessionBody(tokens, "bad_credentials");
    },
  },
  {
    method: "GET", pattern: "/api/session", auth: "public", body: "none",
    handler: async (ctx) => {
      const cookie = cookieValue(ctx.headers, SESSION_COOKIE);
      const session = cookie ? openSession(cookie) : null;
      const tokens = session ? await refreshGrant(session.refreshToken) : null;
      if (!tokens) throw refuse("unauthenticated");
      return sessionBody(tokens, "unauthenticated");
    },
  },
  {
    method: "DELETE", pattern: "/api/session", auth: "user", body: "none",
    handler: async (ctx) => {
      const cookie = cookieValue(ctx.headers, SESSION_COOKIE);
      const session = cookie ? openSession(cookie) : null;
      if (session) await endSession(session.refreshToken);
      return { status: 204, cookies: clearedCookies };
    },
  },

  // ---- accounts
  {
    method: "GET", pattern: "/api/accounts", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const page = await keysetPage(pool, {
        base: "SELECT *, num AS k1 FROM account WHERE NOT deleted",
        params: [], types: ["int"], direction: "desc", filter: "accounts", request: pageRequest(ctx.query),
        map: (row) => accountView(row as never),
      });
      return ok(page);
    },
  },
  {
    method: "POST", pattern: "/api/accounts", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const body = ctx.json();
      const ladder = new Ladder();
      if (typeof body.email === "string" && (await accountByEmail(pool, body.email))) ladder.consider(refuse("email_taken"));
      const errors = new FieldErrors();
      const email = check.text(errors, body, "email", 3, 254);
      if (email !== undefined && EMAIL_PROBLEM(email)) errors.add("email", FIELD.email);
      else if (typeof body.email === "string" && body.email.length > 0 && email === undefined) errors.add("email", FIELD.email);
      const displayName = check.text(errors, body, "display_name", 1, 80);
      const password = body.password;
      if (typeof password !== "string" || [...password].length < 12 || [...password].length > 128) errors.add("password", FIELD.password);
      const role = check.oneOf<Role>(errors, body, "role", ["yacht-owner", "loft-hand"], FIELD.role);
      ladder.settle(errors);
      const account = await createAccount(ctx.actor, { email: email!, displayName: displayName!, password: password as string, role: role! });
      return created(accountView(account));
    },
  },
  {
    method: "PATCH", pattern: "/api/accounts/:id", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const target = await accountById(pool, ctx.params.id!);
      if (!target || target.deleted) throw notFound();
      const body = ctx.json();
      if ("role" in body) await refuseRoleChange(ctx.actor, target);
      const errors = new FieldErrors();
      const displayName = check.text(errors, body, "display_name", 1, 80);
      errors.throwIfAny();
      return ok(accountView(await renameAccount(ctx.actor, target, displayName!)));
    },
  },
  {
    method: "DELETE", pattern: "/api/accounts/:id", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const target = await accountById(pool, ctx.params.id!);
      if (!target || target.deleted) throw notFound();
      if (target.role === "sailmaker") throw refuse("forbidden");
      await removeAccount(ctx.actor, target);
      return { status: 204 };
    },
  },
  {
    method: "GET", pattern: "/api/admin/roles", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return ok({ items: ROLE_TABLE });
    },
  },

  // ---- rule sets and authorities
  {
    method: "GET", pattern: "/api/rulesets", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return ok(await listRuleSets(pool, pageRequest(ctx.query)));
    },
  },
  {
    method: "POST", pattern: "/api/rulesets", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return created(await createRuleSet(ctx.actor, ctx.json()));
    },
  },
  {
    method: "PATCH", pattern: "/api/rulesets/:version", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const version = Number(ctx.params.version);
      const found = Number.isInteger(version) ? await one(pool, "SELECT 1 FROM ruleset WHERE version = $1", [version]) : null;
      if (!found) throw notFound();
      const revision = ifMatchRevision(ctx.headers);
      const saved = await updateRuleSet(ctx.actor, version, revision, ctx.json());
      return { ...ok(saved), headers: { etag: `"${saved.revision}"` } };
    },
  },
  {
    method: "GET", pattern: "/api/authorities", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return ok(await listAuthorities(pool, pageRequest(ctx.query)));
    },
  },
  {
    method: "POST", pattern: "/api/authorities", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return created(await createAuthority(ctx.actor, ctx.json()));
    },
  },
  {
    method: "POST", pattern: "/api/authorities/:id/withdraw", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      if (!(await authorityRow(pool, ctx.params.id!))) throw notFound();
      return ok(await withdrawAuthority(ctx.actor, ctx.params.id!));
    },
  },
  {
    method: "GET", pattern: "/api/admin/audit", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      return ok(await auditPage(pool, pageRequest(ctx.query)));
    },
  },
  {
    method: "GET", pattern: "/api/admin/standing", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const raw = ctx.query.get("season");
      const season = raw === null ? now().getUTCFullYear() : /^\d{4}$/.test(raw) ? Number(raw) : null;
      if (season === null) throw invalid({ season: FIELD.date });
      return ok({ season, seasons: await seasonsWithSubmissions(pool), items: await standingFor(pool, season) });
    },
  },

  // ---- boats and measurements
  {
    method: "GET", pattern: "/api/boats", auth: "user", body: "none",
    handler: async (ctx) => {
      const scope = boatScope(ctx.actor);
      const page = await keysetPage(pool, {
        base: `SELECT b.*, o.email AS owner_email, o.display_name AS owner_name, o.deleted AS owner_deleted, b.num AS k1
                 FROM boat b JOIN account o ON o.id = b.owner_id WHERE ${scope.clause}`,
        params: scope.params, types: ["int"], direction: "desc", filter: "boats", request: pageRequest(ctx.query), map: (row) => row,
      });
      return ok({ ...page, items: await boatViews(pool, page.items, ctx.actor.role) });
    },
  },
  {
    method: "GET", pattern: "/api/boats/:code", auth: "user", body: "none",
    handler: async (ctx) => {
      const row = await visibleBoat(pool, ctx.actor, ctx.params.code!);
      if (!row) throw notFound();
      const view = (await boatViews(pool, [row], ctx.actor.role))[0]!;
      return { ...ok(view), headers: sailmakerEtag(ctx.actor.role, row.revision) };
    },
  },
  {
    method: "POST", pattern: "/api/boats", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const body = ctx.json();
      const errors = new FieldErrors();
      const name = check.text(errors, body, "name", 1, 60);
      const className = check.text(errors, body, "class_name", 1, 60);
      const notes = check.text(errors, body, "notes", 0, 500);
      const owner = await liveAccountOfRole(pool, body.owner_email, "yacht-owner");
      if (!owner) errors.add("owner_email", FIELD.ownerAccount);
      errors.throwIfAny();
      const code = await transaction(async (db) => {
        const num = await nextCode(db, "boat");
        const boatCode = `B-${String(num).padStart(2, "0")}`;
        await run(db, "INSERT INTO boat (code, num, name, class_name, owner_id, notes) VALUES ($1, $2, $3, $4, $5, $6)", [boatCode, num, name, className, owner!.id, notes]);
        await audit(db, { actor: ctx.actor.email, action: "boat.create", target: boatCode, after: name });
        return boatCode;
      });
      return created((await boatViews(pool, [(await boatRow(pool, code))!], "sailmaker"))[0]);
    },
  },
  {
    method: "PATCH", pattern: "/api/boats/:code", auth: "user", body: "json",
    handler: async (ctx) => {
      const row = await visibleBoat(pool, ctx.actor, ctx.params.code!);
      if (!row) throw notFound();
      onlyRoles(ctx, "sailmaker");
      const revision = ifMatchRevision(ctx.headers);
      const body = ctx.json();
      const saved = await transaction(async (db) => {
        const locked = (await one(db, "SELECT * FROM boat WHERE code = $1 FOR UPDATE", [row.code]))!;
        if (locked.revision !== revision) throw refuse("stale_revision");
        const errors = new FieldErrors();
        const name = "name" in body ? check.text(errors, body, "name", 1, 60) : locked.name;
        const className = "class_name" in body ? check.text(errors, body, "class_name", 1, 60) : locked.class_name;
        const notes = "notes" in body ? check.text(errors, body, "notes", 0, 500) : locked.notes;
        errors.throwIfAny();
        await run(db, "UPDATE boat SET name = $2, class_name = $3, notes = $4, revision = revision + 1 WHERE code = $1", [row.code, name, className, notes]);
        await audit(db, { actor: ctx.actor.email, action: "boat.update", target: row.code, before: locked.name, after: name });
        return (await boatRow(db, row.code))!;
      });
      return { ...ok((await boatViews(pool, [saved], "sailmaker"))[0]), headers: { etag: `"${saved.revision}"` } };
    },
  },
  {
    method: "POST", pattern: "/api/boats/:code/measurements", auth: "user", body: "json",
    handler: async (ctx) => {
      const row = await visibleBoat(pool, ctx.actor, ctx.params.code!);
      if (!row) throw notFound();
      onlyRoles(ctx, "sailmaker");
      const body = ctx.json();
      await transaction(async (db) => {
        await one(db, "SELECT 1 FROM boat WHERE code = $1 FOR UPDATE", [row.code]);
        const errors = new FieldErrors();
        const dimension = check.oneOf(errors, body, "dimension", DIMENSION_KEYS, FIELD.dimension);
        const measuredOn = check.measuredOn(errors, body, "measured_on");
        const value = body.value_mm;
        let valueMm: number | undefined;
        if (value === undefined || value === null) errors.add("value_mm", FIELD.required);
        else if (typeof value !== "number" || !inLengthRange(value)) errors.add("value_mm", FIELD.lengthRange);
        else valueMm = value;
        if (dimension && valueMm !== undefined) {
          const current = await currentValue(db, row.code, dimension);
          const tolerance = (await currentRuleSet(db, now())).tolerance_mm;
          if (current !== null && looksLikeInches(valueMm, current, tolerance)) errors.add("value_mm", FIELD.looksLikeInches);
        }
        errors.throwIfAny();
        const before = dimensionState(await rows<MeasurementRow>(db, "SELECT * FROM measurement WHERE boat_code = $1 AND dimension = $2", [row.code, dimension]));
        await insertMeasurement(db, { boatCode: row.code, dimension: dimension!, valueMm: valueMm!, measuredOn: measuredOn!, source: "sailmaker", submissionId: null });
        const after = dimensionState(await rows<MeasurementRow>(db, "SELECT * FROM measurement WHERE boat_code = $1 AND dimension = $2", [row.code, dimension]));
        await stepBackDrawings(db, row.code);
        await audit(db, {
          actor: ctx.actor.email, action: "measurement.record", target: row.code,
          before: before.flagged ? "remeasure" : "measured", after: after.flagged ? "remeasure" : "measured",
        });
      });
      return created((await boatViews(pool, [(await boatRow(pool, row.code))!], "sailmaker"))[0]);
    },
  },
  {
    method: "PUT", pattern: "/api/measurements/:id/photo", auth: "user", body: "photo",
    handler: async (ctx) => {
      const measurement = await one<MeasurementRow>(pool, "SELECT * FROM measurement WHERE id = $1", [ctx.params.id!]);
      const boat = measurement ? await visibleBoat(pool, ctx.actor, measurement.boat_code) : null;
      if (!measurement || !boat) throw notFound();
      onlyRoles(ctx, "sailmaker");
      const type = String(ctx.headers["content-type"]).trim().toLowerCase();
      const sha = sha256Hex(ctx.bytes);
      const key = `tape-photos/${measurement.boat_code}/${measurement.id}/${sha}.${type === "image/png" ? "png" : "jpg"}`;
      await transaction(async (db) => {
        const locked = (await one<MeasurementRow>(db, "SELECT * FROM measurement WHERE id = $1 FOR UPDATE", [measurement.id]))!;
        if (locked.photo_sha256) {
          if (locked.photo_sha256 === sha) return;
          throw refuse("photo_exists");
        }
        try {
          await putObject(key, ctx.bytes, type);
          const back = await getObject(key);
          if (!back || back.body.length !== ctx.bytes.length || sha256Hex(back.body) !== sha) throw new StoreUnavailable();
        } catch (error) {
          if (error instanceof StoreUnavailable) throw storeUnavailable("photo");
          throw error;
        }
        await run(db, "UPDATE measurement SET photo_key = $2, photo_size = $3, photo_sha256 = $4, photo_type = $5 WHERE id = $1", [measurement.id, key, ctx.bytes.length, sha, type]);
        await audit(db, { actor: ctx.actor.email, action: "photo.attach", target: measurement.id, after: sha });
      });
      return ok(await dimensionOfMeasurement(pool, measurement.id, "sailmaker"));
    },
  },
  {
    method: "GET", pattern: "/api/measurements/:id/photo", auth: "user", body: "none",
    handler: async (ctx) => {
      const measurement = await one<MeasurementRow>(pool, "SELECT * FROM measurement WHERE id = $1", [ctx.params.id!]);
      const boat = measurement ? await visibleBoat(pool, ctx.actor, measurement.boat_code) : null;
      if (!measurement || !boat) throw notFound();
      if (!measurement.photo_key) throw notFound();
      let stored;
      try {
        stored = await getObject(measurement.photo_key);
      } catch (error) {
        if (error instanceof StoreUnavailable) throw storeUnavailable("photo");
        throw error;
      }
      if (!stored) throw notFound();
      return {
        status: 200,
        raw: stored.body,
        type: measurement.photo_type!,
        headers: {
          etag: `"${measurement.photo_sha256}"`,
          "content-disposition": `inline; filename="${measurement.id}.${measurement.photo_type === "image/png" ? "png" : "jpg"}"`,
        },
      };
    },
  },

  // ---- submissions
  {
    method: "POST", pattern: "/api/boats/:code/submissions", auth: "user", body: "json",
    handler: async (ctx) => {
      const row = await visibleBoat(pool, ctx.actor, ctx.params.code!);
      if (!row) throw notFound();
      onlyRoles(ctx, "yacht-owner");
      return created(await createSubmission(ctx.actor, row.code, ctx.json()));
    },
  },
  {
    method: "GET", pattern: "/api/submissions", auth: "user", body: "none",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker", "yacht-owner");
      const status = ctx.query.get("status");
      if (status !== null && !["pending", "accepted", "rejected", "reversed"].includes(status)) throw invalid({ status: FIELD.decision });
      return ok(await listSubmissions(pool, ctx.actor, status, pageRequest(ctx.query)));
    },
  },
  {
    method: "POST", pattern: "/api/submissions/:id/decision", auth: "user", body: "json",
    handler: async (ctx) => {
      const row = await submissionRow(pool, ctx.params.id!);
      if (!row || (ctx.actor.role !== "sailmaker" && !(ctx.actor.role === "yacht-owner" && row.submitted_by === ctx.actor.id))) throw notFound();
      onlyRoles(ctx, "sailmaker");
      return ok(await decideSubmission(ctx.actor, row.id, ctx.json()));
    },
  },
  {
    method: "POST", pattern: "/api/submissions/:id/reverse", auth: "user", body: "json",
    handler: async (ctx) => {
      const row = await submissionRow(pool, ctx.params.id!);
      if (!row || (ctx.actor.role !== "sailmaker" && !(ctx.actor.role === "yacht-owner" && row.submitted_by === ctx.actor.id))) throw notFound();
      onlyRoles(ctx, "sailmaker");
      return ok(await reverseSubmission(ctx.actor, row.id, ctx.json()));
    },
  },
  {
    method: "POST", pattern: "/api/admin/submissions/decisions", auth: "user", body: "json",
    handler: async (ctx) => {
      onlyRoles(ctx, "sailmaker");
      const list = ctx.json().decisions;
      if (!Array.isArray(list) || list.length < 1 || list.length > 50) throw invalid({ decisions: "Enter 1 to 50 decisions." });
      const items = list.map((item) => {
        const entry = (item !== null && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return { id: entry.id, decision: entry.decision, reason: entry.reason };
      });
      return ok({ results: await decideMany(ctx.actor, items) });
    },
  },
];
