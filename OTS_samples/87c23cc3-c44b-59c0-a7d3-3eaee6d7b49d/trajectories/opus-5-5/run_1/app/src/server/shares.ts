import { randomBytes, randomUUID } from "node:crypto";
import { memberRoleForAccess, shareStatus, type ShareAccess } from "../shared/access.js";
import { formatBusinessTime } from "../shared/time.js";
import { isUuid, requireUser, validEmail, type User } from "./auth.js";
import { config } from "./config.js";
import { query, transaction, type Queryable } from "./db.js";
import { FIELD, fail, type Fields } from "./errors.js";
import { deny, isWholeNumber } from "./guard.js";
import { json, parseJson, type Context, type Router } from "./http.js";
import { live } from "./live.js";
import { sendMail } from "./mail.js";
import { activeShare, loadProject, projectAccess, projectJson, type ProjectRow, type ShareRow } from "./project-store.js";

const MAX_EXPIRY_SECONDS = 31536000;

function shareJson(share: ShareRow) {
  return {
    id: share.id,
    access: share.access,
    status: shareStatus(share.status, share.expires_at, new Date()),
    url: `/s/${share.token}`,
    token: share.token,
    email: share.email,
    invitation: share.invitation_status
      ? { status: share.invitation_status, sentAt: share.invitation_sent_at ? share.invitation_sent_at.toISOString() : null }
      : null,
    expiresAt: share.expires_at.toISOString(),
    createdAt: share.created_at.toISOString(),
    replacedBy: share.replaced_by,
  };
}

export async function insertShare(
  db: Queryable,
  projectId: string,
  access: ShareAccess,
  email: string | null,
  expiresInSeconds: number,
): Promise<ShareRow> {
  const now = new Date();
  const share: ShareRow = {
    id: randomUUID(),
    project_id: projectId,
    token: randomBytes(24).toString("base64url"),
    access,
    status: "active",
    email,
    invitation_status: email ? "queued" : null,
    invitation_sent_at: null,
    expires_at: new Date(now.getTime() + expiresInSeconds * 1000),
    created_at: now,
    replaced_by: null,
  };
  await db.query(
    `INSERT INTO shares (id, project_id, token, access, status, email, invitation_status, invitation_sent_at, expires_at, created_at, replaced_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      share.id,
      share.project_id,
      share.token,
      share.access,
      share.status,
      share.email,
      share.invitation_status,
      null,
      share.expires_at,
      share.created_at,
      null,
    ],
  );
  return share;
}

/** Emails the invitation and records whether the mail provider accepted it. */
async function deliverInvitation(share: ShareRow, project: ProjectRow): Promise<boolean> {
  let delivered = true;
  try {
    await sendMail({
      to: share.email!,
      subject: `${project.owner_name} shared "${project.name}" on Joinery`,
      lines: [
        `Open it here: ${config.publicUrl}/s/${share.token}`,
        share.access === "view" ? "This link can view the diagram." : "This link can edit the diagram.",
        `It stops working at ${formatBusinessTime(share.expires_at, config.timeZone)}.`,
      ],
    });
  } catch (error) {
    console.error(`Invitation email failed: ${(error as Error).message}`);
    delivered = false;
  }
  share.invitation_status = delivered ? "sent" : "failed";
  share.invitation_sent_at = delivered ? new Date() : share.invitation_sent_at;
  await query("UPDATE shares SET invitation_status = $2, invitation_sent_at = $3 WHERE id = $1", [
    share.id,
    share.invitation_status,
    share.invitation_sent_at,
  ]);
  return delivered;
}

async function ownedShare(db: Queryable, project: ProjectRow, shareId: string): Promise<ShareRow> {
  if (!isUuid(shareId)) throw fail.notFound();
  const rows = await db.query<ShareRow>("SELECT * FROM shares WHERE id = $1 AND project_id = $2 FOR UPDATE", [shareId, project.id]);
  const share = rows.rows[0];
  if (!share) throw fail.notFound();
  return share;
}

function isActive(share: ShareRow): boolean {
  return shareStatus(share.status, share.expires_at, new Date()) === "active";
}

async function manage<T>(ctx: Context, work: (db: Queryable, project: ProjectRow, user: User) => Promise<T>): Promise<T> {
  const user = await requireUser(ctx);
  return transaction(async (db) => {
    const { project, role } = await projectAccess(db, ctx.params.id!, user, true);
    deny(role, "manage");
    return work(db, project, user);
  });
}

interface MemberRow {
  user_id: string;
  display_name: string;
  email: string;
  role: "editor" | "viewer";
  joined_via: string | null;
}

function memberJson(row: MemberRow) {
  return { userId: row.user_id, displayName: row.display_name, email: row.email, role: row.role, joinedVia: row.joined_via };
}

async function activeMember(db: Queryable, project: ProjectRow, userId: string): Promise<MemberRow> {
  if (!isUuid(userId)) throw fail.notFound();
  const rows = await db.query<MemberRow>(
    `SELECT m.user_id, u.display_name, u.email, m.role, m.joined_via FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1 AND m.user_id = $2 AND m.role IN ('editor', 'viewer') FOR UPDATE OF m`,
    [project.id, userId],
  );
  const row = rows.rows[0];
  if (!row) throw fail.notFound();
  return row;
}

export function registerShareRoutes(router: Router): void {
  router.add("POST", "/api/projects/:id/shares", async (ctx) => {
    const { share, project } = await manage(ctx, async (db, project) => {
      const body = parseJson(ctx.body);
      const fields: Fields = {};
      if (body.access !== "view" && body.access !== "edit") fields.access = FIELD.access;
      const email = body.email === undefined || body.email === null || body.email === "" ? null : body.email;
      if (email !== null && !validEmail(email)) fields.email = FIELD.email;
      const expires = body.expiresInSeconds;
      if (expires !== undefined && (!isWholeNumber(expires) || expires < 1 || expires > MAX_EXPIRY_SECONDS))
        fields.expiresInSeconds = FIELD.expiresInSeconds;
      if (Object.keys(fields).length) throw fail.invalid(fields);
      const share = await insertShare(
        db,
        project.id,
        body.access as ShareAccess,
        email === null ? null : (email as string).trim(),
        (expires as number | undefined) ?? config.shareTtlSeconds,
      );
      return { share, project };
    });
    if (share.email) await deliverInvitation(share, project);
    return json(201, shareJson(share));
  });

  router.add("GET", "/api/projects/:id/shares", async (ctx) => {
    const shares = await manage(ctx, async (db, project) => {
      const rows = await db.query<ShareRow>("SELECT * FROM shares WHERE project_id = $1 ORDER BY created_at DESC", [project.id]);
      return rows.rows;
    });
    return json(200, { shares: shares.map(shareJson) });
  });

  router.add("POST", "/api/projects/:id/shares/:shareId/rotate", async (ctx) => {
    const { fresh, old } = await manage(ctx, async (db, project) => {
      const old = await ownedShare(db, project, ctx.params.shareId!);
      if (!isActive(old)) throw fail.shareNotActive();
      const fresh = await insertShare(db, project.id, old.access, null, config.shareTtlSeconds);
      await db.query("UPDATE shares SET status = 'rotated', replaced_by = $2 WHERE id = $1", [old.id, fresh.id]);
      return { fresh, old };
    });
    live.shareEnded(old.project_id, old.id, "rotated");
    return json(201, shareJson(fresh));
  });

  router.add("POST", "/api/projects/:id/shares/:shareId/revoke", async (ctx) => {
    const { share, removed } = await manage(ctx, async (db, project) => {
      const share = await ownedShare(db, project, ctx.params.shareId!);
      if (!isActive(share)) throw fail.shareNotActive();
      await db.query("UPDATE shares SET status = 'revoked' WHERE id = $1", [share.id]);
      share.status = "revoked";
      let removed: string[] = [];
      if (share.access === "edit") {
        const rows = await db.query<{ user_id: string }>(
          `UPDATE members SET role = 'removed', removed_at = $3 WHERE project_id = $1 AND joined_via = $2 AND role IN ('editor', 'viewer')
           RETURNING user_id`,
          [project.id, share.id, new Date()],
        );
        removed = rows.rows.map((r) => r.user_id);
      }
      return { share, removed };
    });
    live.shareEnded(share.project_id, share.id, "revoked");
    for (const userId of removed) live.member(share.project_id, userId, null, "revoked");
    return json(200, shareJson(share));
  });

  router.add("POST", "/api/projects/:id/shares/:shareId/invitation", async (ctx) => {
    const { share, project } = await manage(ctx, async (db, project) => {
      const share = await ownedShare(db, project, ctx.params.shareId!);
      if (!isActive(share)) throw fail.shareNotActive();
      if (!share.email) throw fail.noInvitation();
      return { share, project };
    });
    if (!(await deliverInvitation(share, project))) throw fail.mail();
    return json(200, shareJson(share));
  });

  router.add("GET", "/api/projects/:id/members", async (ctx) => {
    const members = await manage(ctx, async (db, project) => {
      const rows = await db.query<MemberRow>(
        `SELECT m.user_id, u.display_name, u.email, m.role, m.joined_via FROM members m JOIN users u ON u.id = m.user_id
         WHERE m.project_id = $1 AND m.role IN ('editor', 'viewer') ORDER BY m.joined_at`,
        [project.id],
      );
      return rows.rows;
    });
    return json(200, { members: members.map(memberJson) });
  });

  router.add("PATCH", "/api/projects/:id/members/:userId", async (ctx) => {
    const member = await manage(ctx, async (db, project) => {
      if (ctx.params.userId === project.owner_id) throw fail.ownerRoleFixed();
      const member = await activeMember(db, project, ctx.params.userId!);
      const body = parseJson(ctx.body);
      if (body.role !== "editor" && body.role !== "viewer") throw fail.invalid({ role: FIELD.role });
      await db.query("UPDATE members SET role = $3 WHERE project_id = $1 AND user_id = $2", [project.id, member.user_id, body.role]);
      member.role = body.role;
      return { ...member, projectId: project.id };
    });
    live.member(member.projectId, member.user_id, member.role, "role_changed");
    return json(200, memberJson(member));
  });

  router.add("DELETE", "/api/projects/:id/members/:userId", async (ctx) => {
    const removed = await manage(ctx, async (db, project) => {
      if (ctx.params.userId === project.owner_id) throw fail.ownerRoleFixed();
      const member = await activeMember(db, project, ctx.params.userId!);
      await db.query("UPDATE members SET role = 'removed', removed_at = $3 WHERE project_id = $1 AND user_id = $2", [
        project.id,
        member.user_id,
        new Date(),
      ]);
      return { projectId: project.id, userId: member.user_id };
    });
    live.member(removed.projectId, removed.userId, null, "removed");
    return json(204, null);
  });

  router.add("GET", "/api/shared/:token", async (ctx) => {
    const result = await transaction(async (db) => {
      const share = await activeShare(db, ctx.params.token!);
      if (!share) throw fail.notFound();
      return { share, project: (await loadProject(db, share.project_id))! };
    });
    if (result.share.access === "edit") return json(200, { access: "edit", projectName: result.project.name });
    return json(200, projectJson(result.project, "viewer", { via: "link" }));
  });

  router.add("POST", "/api/shared/:token/join", async (ctx) => {
    const user = await requireUser(ctx);
    const result = await transaction(async (db) => {
      const share = await activeShare(db, ctx.params.token!);
      if (!share) throw fail.notFound();
      const project = (await loadProject(db, share.project_id, true))!;
      if (share.access !== "edit") throw fail.readOnly();
      if (project.owner_id === user.id) return { projectId: project.id, role: "owner" };
      const existing = await db.query<{ role: string; removed_at: Date | null }>(
        "SELECT role, removed_at FROM members WHERE project_id = $1 AND user_id = $2",
        [project.id, user.id],
      );
      const row = existing.rows[0];
      if (row && row.role !== "removed") return { projectId: project.id, role: row.role };
      if (row && row.removed_at && share.created_at.getTime() <= row.removed_at.getTime()) throw fail.notFound();
      const role = memberRoleForAccess(share.access);
      await db.query(
        `INSERT INTO members (project_id, user_id, role, joined_via, joined_at, removed_at) VALUES ($1, $2, $3, $4, $5, NULL)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, joined_via = EXCLUDED.joined_via,
           joined_at = EXCLUDED.joined_at, removed_at = NULL`,
        [project.id, user.id, role, share.id, new Date()],
      );
      return { projectId: project.id, role };
    });
    return json(200, result);
  });

  router.add("POST", "/api/shared/:token/edits", async (ctx) => {
    const share = await transaction((db) => activeShare(db, ctx.params.token!));
    if (!share) throw fail.notFound();
    throw share.access === "view" ? fail.readOnly() : fail.joinFirst();
  });
}
