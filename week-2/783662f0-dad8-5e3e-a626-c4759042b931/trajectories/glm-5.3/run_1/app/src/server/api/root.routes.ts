/** The root routes: health, session, invites and preferences. */

import type { Pool } from "../db/pool.js";
import type { Express, Request } from "express";
import { apiError } from "./errors.js";
import { sendError } from "./boundary.js";
import * as sessions from "./sessions.js";
import * as ctx from "./context.js";
import { bodyOf, str, checkFields, bad, userCtx, isUser } from "./helpers.js";
import * as val from "./validation.js";
import { Copy, FieldCopy } from "../../shared/copy.js";
import { Plans } from "../../shared/data.js";
import { inviteByToken, acceptInvite } from "../invites/invites.js";
import { isoInstant, zoneLabelWithZone } from "../time.js";

export function installRootRoutes(app: Express, pool: Pool): void {
  app.get("/api/health", (req, res) => {
    void req;
    res.json({ status: "ok" });
  });

  app.post("/api/session", async (req, res) => {
    const b = bodyOf(req);
    if (checkFields(res, b, ["handle", "passcode"]) !== null) return;
    const fields: Record<string, string> = {};
    const handleError = val.validateHandle(str(b.handle));
    if (handleError !== undefined) fields.handle = handleError;
    const passcodeError = val.validatePasscode(str(b.passcode), false);
    if (passcodeError !== undefined) fields.passcode = passcodeError;
    if (Object.keys(fields).length > 0) {
      bad(res, 422, "validation", "Some fields need attention.", fields);
      return;
    }
    const signed = await sessions.signIn(pool, str(b.handle)!, str(b.passcode)!);
    if (signed === null) {
      bad(res, 401, "bad_credentials", Copy.signIn.wrong);
      return;
    }
    res.setHeader("Set-Cookie", sessions.cookieHeader(signed.token));
    res.json({ user: { handle: signed.user.handle, display_name: signed.user.display_name } });
  });

  app.delete("/api/session", async (req, res) => {
    const token = sessions.sessionToken(req);
    if (token !== null) await sessions.signOut(pool, token);
    res.setHeader("Set-Cookie", sessions.clearCookieHeader());
    res.status(204).end();
  });

  app.get("/api/me", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const servers = await pool.query<{ id: string; slug: string; name: string; owner_id: string; status: string; time_zone: string; plan: string; season: number; suspends_at: Date | null }>(
      "SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = $1 ORDER BY s.name",
      [u.id]
    );
    const list = [];
    for (const server of servers.rows) {
      list.push(await ctx.serverObject(pool, { ...server, plan: server.plan as "hamlet" | "borough", weather_seed: 0, suspends_at: server.suspends_at, kb_checked_at: null }, u.id));
    }
    res.json({ user: { handle: u.handle, display_name: u.display_name }, servers: list, preferences: { sound: u.sound_on } });
  });

  app.post("/api/me/preferences", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["sound"]) !== null) return;
    if (typeof b.sound !== "boolean") {
      bad(res, 422, "validation", "Some fields need attention.", { sound: "Choose whether sound is on." });
      return;
    }
    await pool.query("UPDATE users SET sound_on = $2 WHERE id = $1", [u.id, b.sound]);
    res.json({ preferences: { sound: b.sound } });
  });

  app.get("/api/invites/:token", async (req, res) => {
    const found = await inviteByToken(pool, req.params.token!);
    if ("error" in found) {
      const status = found.error === "unknown" ? 404 : 410;
      const code = found.error === "unknown" ? "not_found" : `invite_${found.error}`;
      const message = found.error === "unknown" ? "Not found." : Copy.join[found.error];
      sendError(res, apiError(status, code, message));
      return;
    }
    res.json({ server_name: found.server_name, inviter: found.inviter, email: found.email });
  });

  app.post("/api/invites/:token/accept", async (req, res) => {
    const b = bodyOf(req);
    if (checkFields(res, b, ["handle", "display_name", "passcode"]) !== null) return;
    const fields: Record<string, string> = {};
    const handleError = val.validateHandle(str(b.handle));
    if (handleError !== undefined) fields.handle = handleError;
    const displayNameError = val.validateDisplayName(str(b.display_name));
    if (displayNameError !== undefined) fields.display_name = displayNameError;
    const passcodeError = val.validatePasscode(str(b.passcode), true);
    if (passcodeError !== undefined) fields.passcode = passcodeError;
    if (Object.keys(fields).length > 0) {
      bad(res, 422, "validation", "Some fields need attention.", fields);
      return;
    }
    const found = await inviteByToken(pool, req.params.token!);
    if ("error" in found) {
      const status = found.error === "unknown" ? 404 : 410;
      const code = found.error === "unknown" ? "not_found" : `invite_${found.error}`;
      const message = found.error === "unknown" ? "Not found." : Copy.join[found.error];
      sendError(res, apiError(status, code, message));
      return;
    }
    const accepted = await acceptInvite(pool, req.params.token!, {
      handle: str(b.handle)!,
      display_name: str(b.display_name)!,
      passcode: str(b.passcode)!,
    });
    if (!accepted.ok) {
      if (accepted.error === "email_in_use") {
        sendError(res, apiError(409, "email_in_use", Copy.join.emailInUse));
        return;
      }
      if (accepted.error === "handle_taken") {
        bad(res, 422, "validation", "Some fields need attention.", { handle: FieldCopy.handle.taken });
        return;
      }
      const invite = (await pool.query<{ server_id: string }>("SELECT server_id FROM invites WHERE token = $1", [req.params.token!])).rows[0];
      const plan = invite === undefined ? undefined : (await pool.query<{ plan: "hamlet" | "borough" }>("SELECT plan FROM servers WHERE id = $1", [invite.server_id])).rows[0];
      sendError(res, apiError(409, "member_limit_reached", Copy.join.memberLimit(plan === undefined ? 6 : Plans[plan.plan].members)));
      return;
    }
    const token = await sessions.createSession(pool, accepted.userId);
    res.setHeader("Set-Cookie", sessions.cookieHeader(token));
    const serverRow = (await pool.query<{ id: string; slug: string; name: string; owner_id: string; status: string; time_zone: string; plan: string; season: number; suspends_at: Date | null }>(
      "SELECT * FROM servers WHERE id = $1",
      [accepted.serverId]
    )).rows[0];
    const server = await ctx.serverObject(
      pool,
      { ...serverRow!, plan: serverRow!.plan as "hamlet" | "borough", weather_seed: 0, suspends_at: serverRow!.suspends_at, kb_checked_at: null },
      accepted.userId
    );
    res.status(201).json({
      user: { handle: str(b.handle)!, display_name: str(b.display_name)! },
      server,
    });
  });

  void isoInstant;
  void zoneLabelWithZone;
  void req_unused;
}

function req_unused(req: Request): void {
  void req;
}
