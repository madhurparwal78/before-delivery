import type { Share, ShareRole } from "../../shared/api";
import { pool, query, queryOne } from "../db";
import type { Db } from "../db";
import { conflict, notFound } from "../errors";
import { Problems, defineRoute, reply } from "../http";
import { revokeAccess } from "../live";
import { sendMail } from "../mail";
import { markStale, runIndexer, searchFor } from "../search";
import { settings } from "../config";
import { hashToken, newId, newToken } from "../session";
import { EMAIL, field, length } from "../validate";

const SHARE_SELECT = `
  SELECT s.id, s.email, COALESCE(u.display_name, (SELECT x.display_name FROM users x WHERE lower(x.email) = lower(s.email))) AS display_name,
         s.role, s.status
    FROM shares s LEFT JOIN users u ON u.id = s.user_id`;

const listShares = (db: Db, notebookId: string): Promise<Share[]> =>
  query<Share>(db, `${SHARE_SELECT} WHERE s.notebook_id = $1 ORDER BY s.created_at`, [notebookId]);

const sharesList = defineRoute({
  method: "GET",
  path: "/api/notebooks/:id/shares",
  access: "session",
  notebook: "owner",
  run: async (ctx) => reply(200, { shares: await listShares(pool, ctx.notebook().id) }),
});

interface ShareBody {
  email: string;
  role: ShareRole;
}

const sharesCreate = defineRoute<undefined, ShareBody>({
  method: "POST",
  path: "/api/notebooks/:id/shares",
  access: "session",
  notebook: "owner",
  write: true,
  body: "json",
  check: async (ctx, _resource, body) => {
    const email = field(body, "email");
    if (typeof email !== "string" || !EMAIL.test(email)) return;
    const taken = await queryOne(await ctx.transaction(), "SELECT 1 FROM shares WHERE notebook_id = $1 AND lower(email) = lower($2)", [ctx.notebook().id, email.trim()]);
    if (taken) throw conflict("already_shared", "That person already has access.");
  },
  validate: (body, _resource, ctx) => {
    const email = field(body, "email");
    const role = field(body, "role");
    const problems = new Problems();
    if (typeof email !== "string" || !EMAIL.test(email) || length(email) > 254) problems.add("email", "must be a valid email address");
    else if (email.trim().toLowerCase() === ctx.me().email.toLowerCase()) problems.add("email", "is the owner");
    if (role !== "editor" && role !== "viewer") problems.add("role", 'must be "editor" or "viewer"');
    problems.done();
    return { email: (email as string).trim(), role: role as ShareRole };
  },
  run: async (ctx, _resource, body) => {
    const db = await ctx.transaction();
    const id = newId("sh");
    const token = newToken();
    await db.query("INSERT INTO shares (id, notebook_id, email, role, status, token_hash) VALUES ($1, $2, $3, $4, 'invited', $5)", [
      id,
      ctx.notebook().id,
      body.email,
      body.role,
      hashToken(token),
    ]);
    const notebook = await queryOne<{ title: string }>(db, "SELECT title FROM notebooks WHERE id = $1", [ctx.notebook().id]);
    await sendMail(
      body.email,
      `${ctx.me().display_name} shared “${notebook?.title ?? ""}” with you`,
      `${ctx.me().display_name} invited you to ${body.role === "editor" ? "edit" : "read"} the notebook “${notebook?.title ?? ""}” on Brackenpad.\n\nRole: ${body.role === "editor" ? "Editor" : "Viewer"}\n\nOpen the invitation:\n${settings.publicUrl}/invite/${token}\n`,
    );
    const share = await queryOne<Share>(db, `${SHARE_SELECT} WHERE s.id = $1`, [id]);
    return reply(201, { share });
  },
});

const sharesDelete = defineRoute<{ userId: string | null; id: string }>({
  method: "DELETE",
  path: "/api/notebooks/:id/shares/:shareId",
  access: "session",
  notebook: "owner",
  write: true,
  resolve: async (ctx) => {
    const row = await queryOne<{ id: string; user_id: string | null }>(pool, "SELECT id, user_id FROM shares WHERE id = $1 AND notebook_id = $2", [
      ctx.params.shareId,
      ctx.notebook().id,
    ]);
    if (!row) throw notFound();
    return { userId: row.user_id, id: row.id };
  },
  run: async (ctx, share) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    await db.query("DELETE FROM shares WHERE id = $1", [share.id]);
    if (share.userId) {
      await db.query("DELETE FROM presence WHERE notebook_id = $1 AND user_id = $2", [notebookId, share.userId]);
      await db.query("DELETE FROM cell_locks WHERE notebook_id = $1 AND user_id = $2", [notebookId, share.userId]);
    }
    await markStale(db, notebookId);
    ctx.afterCommit(() => {
      if (share.userId) revokeAccess(notebookId, share.userId);
      void runIndexer();
    });
    return reply(204);
  },
});

const search = defineRoute<undefined, string>({
  method: "GET",
  path: "/api/search",
  access: "session",
  validate: (_body, _resource, ctx) => {
    const q = ctx.url.searchParams.get("q") ?? "";
    if (length(q) < 1 || length(q) > 200) {
      const problems = new Problems();
      problems.add("q", "must be 1 to 200 characters");
      problems.done();
    }
    return q;
  },
  run: async (ctx, _resource, q) => {
    const hits = await searchFor(ctx.me().id, q);
    if (hits.length === 0) return reply(200, { results: [] });
    const allowed = await query<{ id: string; title: string }>(
      pool,
      `SELECT n.id, n.title FROM notebooks n LEFT JOIN shares s ON s.notebook_id = n.id AND s.user_id = $1 AND s.status = 'active'
        WHERE n.id = ANY($2::text[]) AND (n.owner_id = $1 OR s.id IS NOT NULL)`,
      [ctx.me().id, hits.map((hit) => hit.id)],
    );
    const byId = new Map(allowed.map((row) => [row.id, row]));
    return reply(200, { results: hits.flatMap((hit) => byId.get(hit.id) ?? []) });
  },
});

export const shareRoutes = [sharesList, sharesCreate, sharesDelete, search];
