import { todayIn } from "../../shared/time.js";
import {
  caller,
  clearedCookie,
  hashToken,
  hashPassword,
  loadCaller,
  memberJson,
  newToken,
  passwordMatches,
  signIn,
  signOut,
  workspaceJson,
  type MemberRow,
  type WorkspaceRow,
} from "../auth.js";
import { config } from "../config.js";
import { sql } from "../db.js";
import { HttpError, json, parseJson, route } from "../http.js";
import { attemptNow, enqueue } from "../outbox.js";
import { moveSessionsToZone } from "./sessions.js";
import * as check from "../validate.js";

const MEMBER_COLUMNS = sql`id, workspace_id, role, status, name, email, time_zone, threshold_minutes`;

function emailTaken(): HttpError {
  return new HttpError(409, "email_taken", "That email already has a Daybook.");
}

route("GET", "/api/health", async () => {
  await sql`SELECT 1`;
  return json(200, { status: "ok" });
});

route(
  "POST",
  "/api/workspaces",
  async (ctx) => {
    const body = parseJson(ctx);
    const emailCheck = check.email(body.email);
    if (!emailCheck) {
      const [taken] = await sql`SELECT 1 FROM members WHERE lower(email) = lower(${String(body.email).trim()}) AND removed_at IS NULL`;
      if (taken) throw emailTaken();
    }
    check.settle({
      workspaceName: check.text(body.workspaceName, "a workspace name", 80),
      ownerName: check.text(body.ownerName, "your name", 80),
      email: emailCheck,
      password: check.password(body.password),
      timeZone: check.zone(body.timeZone),
    });
    const passwordHash = await hashPassword(String(body.password));
    const now = Date.now();
    const created = await sql
      .begin(async (tx) => {
        const [workspace] = await tx<WorkspaceRow[]>`
          INSERT INTO workspaces (name, created_at, trial_ends_at)
          VALUES (${String(body.workspaceName).trim()}, ${new Date(now)}, ${new Date(now + config.trialLengthSeconds * 1000)})
          RETURNING id, name, state, trial_ends_at`;
        const [member] = await tx<MemberRow[]>`
          INSERT INTO members (workspace_id, role, status, name, email, password_hash, time_zone, feed_token)
          VALUES (${workspace.id}, 'owner', 'active', ${String(body.ownerName).trim()}, ${String(body.email).trim()},
                  ${passwordHash}, ${String(body.timeZone)}, ${newToken()})
          RETURNING ${MEMBER_COLUMNS}`;
        const job = await enqueue(tx, workspace.id, "killbill.register_workspace", { workspaceId: workspace.id });
        const cookie = await signIn(tx, member.id);
        return { workspace, member, job, cookie };
      })
      .catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "23505") throw emailTaken();
        throw error;
      });
    const billing = (await attemptNow(created.job)).done ? "registered" : "queued";
    return json(
      201,
      { workspace: workspaceJson(created.workspace), member: memberJson(created.member), billing },
      { "Set-Cookie": created.cookie },
    );
  },
  "json",
);

route(
  "POST",
  "/api/auth/sign-in",
  async (ctx) => {
    const body = parseJson(ctx);
    const [found] =
      typeof body.email === "string"
        ? await sql<{ id: string; password_hash: string | null }[]>`
            SELECT id, password_hash FROM members
            WHERE lower(email) = lower(${body.email.trim()}) AND removed_at IS NULL AND status = 'active'`
        : [];
    if (!found || typeof body.password !== "string" || !(await passwordMatches(body.password, found.password_hash))) {
      throw new HttpError(401, "invalid_credentials", "That email and password don't match.");
    }
    const cookie = await signIn(sql, found.id);
    const { member, workspace } = await loadCaller(found.id);
    return json(200, { member: memberJson(member), workspace: workspace ? workspaceJson(workspace) : null }, { "Set-Cookie": cookie });
  },
  "json",
);

route("POST", "/api/auth/sign-out", async (ctx) => {
  await signOut(ctx);
  return { status: 204, headers: { "Set-Cookie": clearedCookie() } };
});

route("GET", "/api/me", async (ctx) => {
  const { member, workspace } = await caller(ctx);
  return json(200, {
    member: memberJson(member),
    workspace: workspace ? workspaceJson(workspace) : null,
    today: todayIn(member.time_zone, Date.now()),
  });
});

route(
  "PATCH",
  "/api/me",
  async (ctx) => {
    const { member } = await caller(ctx);
    const body = parseJson(ctx);
    check.settle({
      timeZone: body.timeZone === undefined ? null : check.zone(body.timeZone),
      thresholdMinutes: body.thresholdMinutes === undefined ? null : check.stepped(body.thresholdMinutes, 60, 960, 15, "minutes"),
    });
    const zone = typeof body.timeZone === "string" ? body.timeZone : member.time_zone;
    const threshold = typeof body.thresholdMinutes === "number" ? body.thresholdMinutes : member.threshold_minutes;
    const updated = await sql.begin(async (tx) => {
      const [row] = await tx<MemberRow[]>`
        UPDATE members SET time_zone = ${zone}, threshold_minutes = ${threshold} WHERE id = ${member.id}
        RETURNING ${MEMBER_COLUMNS}`;
      if (zone !== member.time_zone) await moveSessionsToZone(tx, member.id, zone);
      return row;
    });
    return json(200, { member: memberJson(updated), today: todayIn(updated.time_zone, Date.now()) });
  },
  "json",
);

type Invitation = { id: string; status: string; email: string; workspace_name: string; workspace_id: string };

async function invitation(token: string): Promise<Invitation> {
  const [found] = await sql<Invitation[]>`
    SELECT m.id, m.status, m.email, w.name AS workspace_name, w.id AS workspace_id
    FROM members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.invite_token_hash = ${hashToken(token)} AND m.removed_at IS NULL`;
  if (!found) throw new HttpError(404, "not_found", "That invite link isn't valid.");
  if (found.status === "active") throw new HttpError(410, "invitation_used", "This invite has already been used.");
  return found;
}

route("GET", "/api/invitations/{token}", async (ctx) => {
  const found = await invitation(ctx.params.token);
  return json(200, { workspaceName: found.workspace_name, email: found.email });
});

route(
  "POST",
  "/api/invitations/{token}/accept",
  async (ctx) => {
    const found = await invitation(ctx.params.token);
    const body = parseJson(ctx);
    check.settle({
      name: check.text(body.name, "your name", 80),
      password: check.password(body.password),
      timeZone: check.zone(body.timeZone),
    });
    const passwordHash = await hashPassword(String(body.password));
    const result = await sql.begin(async (tx) => {
      const [member] = await tx<MemberRow[]>`
        UPDATE members SET status = 'active', name = ${String(body.name).trim()}, password_hash = ${passwordHash},
               time_zone = ${String(body.timeZone)}
        WHERE id = ${found.id} AND status = 'invited'
        RETURNING ${MEMBER_COLUMNS}`;
      if (!member) throw new HttpError(410, "invitation_used", "This invite has already been used.");
      const [workspace] = await tx<WorkspaceRow[]>`
        SELECT id, name, state, trial_ends_at FROM workspaces WHERE id = ${found.workspace_id}`;
      return { member, workspace, cookie: await signIn(tx, member.id) };
    });
    return json(201, { member: memberJson(result.member), workspace: workspaceJson(result.workspace) }, { "Set-Cookie": result.cookie });
  },
  "json",
);
