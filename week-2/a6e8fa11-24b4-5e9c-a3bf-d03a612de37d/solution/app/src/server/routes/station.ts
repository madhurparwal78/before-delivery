// Station settings, members and invites.
import { randomUUID } from "node:crypto";
import { type LocalDateTime, parseLocalDateTime, resolveLocalForward, timeZoneList } from "../../shared/time.js";
import { hashPassword, memberById, newToken, sessionCookie, startSession, tokenHash, userBody } from "../auth.js";
import { tx } from "../db.js";
import { ApiError, invalid, notFound } from "../errors.js";
import { SESSION_COOKIE, jsonBody, member, open } from "../http.js";
import { queueInvite } from "../mail.js";
import { type Role, isRole, requireRole } from "../rules/roles.js";
import { type Services } from "../services/index.js";
import { isUuid } from "../workbook.js";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "invited" | "active";
}

const memberOut = (m: MemberRow): MemberRow => ({ id: m.id, name: m.name, email: m.email, role: m.role, status: m.status });
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const zones = new Set(timeZoneList());

export function stationRoutes(svc: Services): void {
  member("GET", "/api/station", async ({ member: me }) => ({
    status: 200,
    json: { station: { id: me.stationId, name: me.stationName, timeZone: me.timeZone } },
  }));

  member("PATCH", "/api/station", async ({ req, member: me }) => {
    requireRole(me.role, "manageStation");
    const zone = jsonBody(req).timeZone;
    if (typeof zone !== "string" || !zones.has(zone)) throw invalid({ timeZone: "Pick a time zone from the list." });
    await tx(svc.db, async (t) => {
      await t.query("UPDATE stations SET time_zone = $2 WHERE id = $1", [me.stationId, zone]);
      // Each cutoff is a wall-clock time in the station's zone, so its instant moves with the zone.
      const cutoffs = await t.query<{ id: string; closes_at_local: string }>(
        "SELECT id, closes_at_local FROM workbooks WHERE station_id = $1 AND closes_at_local IS NOT NULL FOR UPDATE",
        [me.stationId],
      );
      for (const w of cutoffs.rows) {
        const local = parseLocalDateTime(w.closes_at_local) as LocalDateTime;
        await t.query("UPDATE workbooks SET closes_at_utc = $2 WHERE id = $1", [w.id, new Date(resolveLocalForward(local, zone))]);
      }
    });
    return { status: 200, json: { station: { id: me.stationId, name: me.stationName, timeZone: zone } } };
  });

  member("GET", "/api/station/members", async ({ member: me }) => {
    requireRole(me.role, "manageStation");
    const r = await svc.db.query<MemberRow>("SELECT * FROM members WHERE station_id = $1 ORDER BY name, email", [me.stationId]);
    return { status: 200, json: { members: r.rows.map(memberOut) } };
  });

  member("POST", "/api/station/members", async ({ req, member: me }) => {
    requireRole(me.role, "manageStation");
    const body = jsonBody(req);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (EMAIL.test(email)) {
      const taken = await svc.db.query("SELECT 1 FROM members WHERE lower(email) = lower($1)", [email]);
      if (taken.rowCount) throw new ApiError(409, "member_exists", `${email} is already a member of this station.`);
    }
    const fields: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 80) fields.name = "Enter a name of 1 to 80 characters.";
    if (!EMAIL.test(email)) fields.email = "Enter a valid email address.";
    if (!isRole(body.role)) fields.role = "Pick a role.";
    if (Object.keys(fields).length) throw invalid(fields);
    const role = body.role as Role;
    const token = newToken();
    const created = await tx(svc.db, async (t) => {
      const r = await t
        .query<MemberRow>("INSERT INTO members (id, station_id, name, email, role, status) VALUES ($1, $2, $3, $4, $5, 'invited') RETURNING *", [
          randomUUID(),
          me.stationId,
          name,
          email,
          role,
        ])
        .catch((error: { code?: string }) => {
          // A concurrent invite for the same email won the unique index.
          if (error.code === "23505") throw new ApiError(409, "member_exists", `${email} is already a member of this station.`);
          throw error;
        });
      await t.query("INSERT INTO invites (token_hash, member_id) VALUES ($1, $2)", [tokenHash(token), r.rows[0].id]);
      const mailId = await queueInvite(t, { to: email, name, role, stationName: me.stationName, link: `${req.origin}/invite/${token}` });
      return { member: r.rows[0], mailId };
    });
    const sent = await svc.workers.sendNow(created.mailId);
    return { status: 201, json: { member: memberOut(created.member), invite: sent ? "sent" : "queued" } };
  });

  const stationMember = async (stationId: string, id: string): Promise<MemberRow> => {
    if (!isUuid(id)) throw notFound();
    const r = await svc.db.query<MemberRow>("SELECT * FROM members WHERE id = $1 AND station_id = $2", [id, stationId]);
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  };

  const lastDataManager = async (stationId: string, leaving: MemberRow): Promise<boolean> => {
    if (leaving.role !== "data_manager") return false;
    const r = await svc.db.query("SELECT 1 FROM members WHERE station_id = $1 AND role = 'data_manager' AND id <> $2", [stationId, leaving.id]);
    return r.rowCount === 0;
  };

  member("PATCH", "/api/station/members/:memberId", async ({ req, member: me }) => {
    const target = await stationMember(me.stationId, req.params.memberId);
    requireRole(me.role, "manageStation");
    const role = jsonBody(req).role;
    if (!isRole(role)) throw invalid({ role: "Pick a role." });
    if (role !== "data_manager" && (await lastDataManager(me.stationId, target))) {
      throw new ApiError(409, "last_data_manager", "The station needs at least one data manager.");
    }
    const r = await svc.db.query<MemberRow>("UPDATE members SET role = $2 WHERE id = $1 RETURNING *", [target.id, role]);
    return { status: 200, json: { member: memberOut(r.rows[0]) } };
  });

  member("DELETE", "/api/station/members/:memberId", async ({ req, member: me }) => {
    const target = await stationMember(me.stationId, req.params.memberId);
    requireRole(me.role, "manageStation");
    if (await lastDataManager(me.stationId, target)) throw new ApiError(409, "last_data_manager", "The station needs at least one data manager.");
    // Sessions, invites, open conflicts and export requests go with the member.
    await svc.db.query("DELETE FROM members WHERE id = $1", [target.id]);
    return { status: 204 };
  });

  const pendingInvite = async (token: string): Promise<{ member_id: string; name: string; station_name: string }> => {
    const r = await svc.db.query<{ member_id: string; name: string; station_name: string }>(
      `SELECT i.member_id, m.name, s.name AS station_name FROM invites i JOIN members m ON m.id = i.member_id JOIN stations s ON s.id = m.station_id
       WHERE i.token_hash = $1 AND m.status = 'invited'`,
      [tokenHash(token)],
    );
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  };

  open("GET", "/api/invites/:token", async ({ req }) => {
    const invite = await pendingInvite(req.params.token);
    return { status: 200, json: { invite: { name: invite.name, stationName: invite.station_name } } };
  });

  open("POST", "/api/invites/:token/accept", async ({ req }) => {
    const invite = await pendingInvite(req.params.token);
    const password = jsonBody(req).password;
    if (typeof password !== "string" || password.length < 10) throw invalid({ password: "Use at least 10 characters." });
    const hash = await hashPassword(password);
    const token = await tx(svc.db, async (t) => {
      const used = await t.query("DELETE FROM invites WHERE token_hash = $1 RETURNING member_id", [tokenHash(req.params.token)]);
      if (!used.rowCount) throw notFound();
      await t.query("UPDATE members SET password_hash = $2, status = 'active' WHERE id = $1", [invite.member_id, hash]);
      return startSession(t, invite.member_id);
    });
    return { status: 200, json: userBody(await memberById(svc.db, invite.member_id)), headers: { "Set-Cookie": sessionCookie(SESSION_COOKIE, token) } };
  });
}
