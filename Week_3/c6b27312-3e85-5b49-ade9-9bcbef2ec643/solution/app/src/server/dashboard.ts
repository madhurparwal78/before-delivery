// The signed-in person's own parts, review rooms and liked parts.
import type { DashboardJson } from "../shared/api";
import { foldEmail } from "../shared/text";
import { db } from "./db";
import type { Ctx } from "./http";
import { get, type Route } from "./route";
import { headRevision, revisionLabel } from "./records";
import { jsonReply } from "./reply";
import { roomJson } from "./rooms";

async function dashboard(ctx: Ctx) {
  const user = await ctx.requireUser();
  const parts = await db.rows<{ slug: string; title: string; visibility: string; likes: number; head_id: string; head_n: number; geometry_digest: string }>(
    `SELECT p.slug, p.title, p.visibility,
            (SELECT count(*)::int FROM likes l WHERE l.part_slug = p.slug) AS likes,
            h.id AS head_id, h.n AS head_n, h.geometry_digest
       FROM parts p
       JOIN LATERAL (SELECT id, n, geometry_digest FROM revisions WHERE part_slug = p.slug ORDER BY n DESC LIMIT 1) h ON true
      WHERE p.owner_id = $1 AND p.listed
      ORDER BY p.created_at DESC, p.slug`,
    [user.id],
  );
  const roomIds = await db.rows<{ id: string }>(
    `SELECT r.id FROM rooms r JOIN parts p ON p.slug = r.part_slug
      WHERE p.owner_id = $1
         OR ($3 AND EXISTS (SELECT 1 FROM room_reviewers rr WHERE rr.room_id = r.id AND rr.email_fold = $2))
      ORDER BY r.created_at DESC, r.id`,
    [user.id, foldEmail(user.email), user.verified],
  );
  const rooms = await Promise.all(
    roomIds.map(async ({ id }) => {
      const room = await roomJson(db, id);
      const head = await headRevision(db, room.partSlug);
      return { id, title: room.title, partSlug: room.partSlug, state: room.state, approvals: room.approvals.length, requiredApprovals: room.requiredApprovals, geometryDigest: head.geometry_digest };
    }),
  );
  const liked = await db.rows<{ slug: string; title: string; author: string; geometry_digest: string }>(
    `SELECT p.slug, p.title, u.display_name AS author, h.geometry_digest
       FROM likes l
       JOIN parts p ON p.slug = l.part_slug
       JOIN users u ON u.id = p.owner_id
       JOIN LATERAL (SELECT geometry_digest FROM revisions WHERE part_slug = p.slug ORDER BY n DESC LIMIT 1) h ON true
      WHERE l.user_id = $1
      ORDER BY l.created_at DESC, p.slug`,
    [user.id],
  );
  const body: DashboardJson = {
    parts: parts.map((p) => ({
      slug: p.slug,
      title: p.title,
      visibility: p.visibility,
      likes: p.likes,
      head: { id: p.head_id, label: revisionLabel(p.head_n), geometryDigest: p.geometry_digest },
      revisionCount: p.head_n,
    })),
    rooms,
    liked: liked.map((l) => ({ slug: l.slug, title: l.title, author: l.author, geometryDigest: l.geometry_digest })),
  };
  return jsonReply(200, body);
}

export const dashboardRoutes: Route[] = [get("/api/dashboard", dashboard)];
