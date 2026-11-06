import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { roomFigures } from "../shared/lightpool.js";
import type { LiveEvent, Placement, Project, ProjectLine, Share } from "../shared/types.js";
import { isApprovedTrade, type UserRow } from "./auth.js";
import { variantByCode } from "./catalogue.js";
import { pool, transaction, type Queryable } from "./db.js";
import { apiError, notFound, validation } from "./errors.js";
import { Fields, isEmail, type Body } from "./fields.js";
import { COVER_LIMIT, json, STREAMING, type Route } from "./http.js";
import { listComments, liveConnected, openStream, postComment, recordPlacement } from "./live.js";
import type { PbRecord } from "./pocketbase.js";
import { kickShares } from "./shares.js";
import { getObject, putConfirmed } from "./storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CEILING = { min: 2400, max: 4000 };
const ROOM = { min: 2000, max: 20000 };

interface ProjectRow {
  id: string;
  name: string;
  client_name: string | null;
  owner_id: string;
  ceiling_height_mm: number;
  room_width_mm: number;
  room_depth_mm: number;
  cover_key: string | null;
}

const PROJECT_COLUMNS =
  "p.id, p.name, p.client_name, p.owner_id, p.ceiling_height_mm, p.room_width_mm, p.room_depth_mm, p.cover_key";

/** The project when the caller owns it or collaborates on it; everyone else gets the 404. */
async function projectFor(user: UserRow, id: string, db: Queryable = pool, lock = false): Promise<ProjectRow> {
  if (!UUID.test(id)) throw notFound();
  const found = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects p
     WHERE p.id = $1 AND (p.owner_id = $2 OR EXISTS (
       SELECT 1 FROM project_collaborators c WHERE c.project_id = p.id AND c.user_id = $2))${lock ? " FOR UPDATE OF p" : ""}`,
    [id, user.id],
  );
  if (!found.rows[0]) throw notFound();
  return found.rows[0];
}

function ownerOnly(user: UserRow, project: ProjectRow): void {
  if (project.owner_id !== user.id) throw apiError(403, "owner_only");
}

async function placements(db: Queryable, project: ProjectRow): Promise<Placement[]> {
  const rows = await db.query<Omit<Placement, "pool_diameter_mm" | "own_lux" | "centre_lux">>(
    `SELECT pl.id, pl.variant_code, pl.ordinal, pl.x_mm, pl.y_mm, v.beam_deg, v.cct_k, v.candela
     FROM placements pl JOIN variants v ON v.code = pl.variant_code
     WHERE pl.project_id = $1 ORDER BY pl.created_at, pl.id`,
    [project.id],
  );
  return roomFigures(rows.rows, project.ceiling_height_mm);
}

async function summary(db: Queryable, project: ProjectRow, user: UserRow): Promise<Omit<Project, "placements">> {
  const [lines, collaborators] = await Promise.all([
    db.query<ProjectLine>(
      `SELECT pl.variant_code, pr.name AS product_name, pl.quantity,
         (SELECT count(*) FROM placements x WHERE x.project_id = pl.project_id AND x.variant_code = pl.variant_code)::int AS placed
       FROM project_lines pl JOIN variants v ON v.code = pl.variant_code JOIN products pr ON pr.slug = v.product_slug
       WHERE pl.project_id = $1 ORDER BY pl.added_at, pl.variant_code`,
      [project.id],
    ),
    db.query<{ user_id: string; name: string; email: string }>(
      `SELECT u.id AS user_id, u.name, u.email FROM project_collaborators c JOIN users u ON u.id = c.user_id
       WHERE c.project_id = $1 ORDER BY c.added_at`,
      [project.id],
    ),
  ]);
  return {
    id: project.id,
    name: project.name,
    client_name: project.client_name,
    owner_id: project.owner_id,
    is_owner: project.owner_id === user.id,
    ceiling_height_mm: project.ceiling_height_mm,
    room_width_mm: project.room_width_mm,
    room_depth_mm: project.room_depth_mm,
    cover: project.cover_key
      ? { status: "ready", url: `/api/projects/${project.id}/cover?v=${project.cover_key.split("/").pop()}` }
      : null,
    lines: lines.rows,
    collaborators: collaborators.rows,
    live: liveConnected(),
  };
}

async function fullProject(db: Queryable, project: ProjectRow, user: UserRow): Promise<Project> {
  return { ...(await summary(db, project, user)), placements: await placements(db, project) };
}

async function placementById(db: Queryable, project: ProjectRow, id: string): Promise<Placement | undefined> {
  return (await placements(db, project)).find((p) => p.id === id);
}

function readRoom(fields: Fields) {
  return {
    ceiling: fields.optionalInt("ceiling_height_mm", CEILING),
    width: fields.optionalInt("room_width_mm", ROOM),
    depth: fields.optionalInt("room_depth_mm", ROOM),
  };
}

function readCoordinates(body: Body, project: ProjectRow): { x: number; y: number } {
  const fields = new Fields(body);
  const x = fields.int("x_mm", { min: 0, max: project.room_width_mm });
  const y = fields.int("y_mm", { min: 0, max: project.room_depth_mm });
  fields.done();
  return { x, y };
}

// ---- Cover upload ----------------------------------------------------------------------------

const IMAGE_TYPES: { ext: string; type: string; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", type: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", type: "image/webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** The `image` file part of a multipart/form-data body, or null. */
function imagePart(req: IncomingMessage, raw: Buffer): Buffer | null {
  const boundary = /boundary="?([^";]+)"?/i.exec(req.headers["content-type"] ?? "")?.[1];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = raw.indexOf(delimiter);
  while (start >= 0) {
    const next = raw.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const part = raw.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const headers = part.subarray(0, split).toString("utf8");
      if (/name="image"/i.test(headers)) return part.subarray(split + 4);
    }
    start = next;
  }
  return null;
}

// ---- Live relay ------------------------------------------------------------------------------

/** Turns an lf_placements record into the event browsers receive, using this database's placement. */
export async function placementEvent(projectId: string, record: PbRecord): Promise<LiveEvent | null> {
  const id = String(record.placement_id);
  const action = String(record.action);
  if (action === "deleted") {
    return { type: "placement", data: { action: "deleted", placement: { id, variant_code: String(record.variant_code) } } };
  }
  const found = await pool.query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = $1`, [projectId]);
  if (!found.rows[0]) return null;
  const placement = await placementById(pool, found.rows[0], id);
  if (!placement) return null;
  return { type: "placement", data: { action: action === "created" ? "created" : "updated", placement } };
}

// ---- Routes ----------------------------------------------------------------------------------

function requireTrade(user: UserRow): void {
  if (!isApprovedTrade(user)) throw apiError(403, "trade_account_required");
}

const SHARE_COLUMNS = "s.id, s.price_display, s.recipients, s.pdf_status, s.created_at";

function share(row: Share & { created_at: string | Date }): Share {
  return { ...row, created_at: new Date(row.created_at).toISOString() };
}

export const projectRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/projects",
    access: "user",
    async handler({ body, user }) {
      requireTrade(user!);
      const fields = new Fields(body);
      const name = fields.text("name", { max: 120 });
      const client = fields.optionalText("client_name", 120);
      const room = readRoom(fields);
      fields.done();
      const created = await pool.query<ProjectRow>(
        `INSERT INTO projects AS p (name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm)
         VALUES ($1, $2, $3, coalesce($4, 2700), coalesce($5, 6000), coalesce($6, 4500)) RETURNING ${PROJECT_COLUMNS}`,
        [name, client, user!.id, room.ceiling, room.width, room.depth],
      );
      return json(201, { project: await fullProject(pool, created.rows[0]!, user!) });
    },
  },
  {
    method: "GET",
    path: "/api/projects",
    access: "user",
    async handler({ user }) {
      requireTrade(user!);
      const rows = await pool.query<ProjectRow>(
        `SELECT ${PROJECT_COLUMNS} FROM projects p
         WHERE p.owner_id = $1 OR EXISTS (SELECT 1 FROM project_collaborators c WHERE c.project_id = p.id AND c.user_id = $1)
         ORDER BY p.created_at DESC`,
        [user!.id],
      );
      return json(200, { projects: await Promise.all(rows.rows.map((row) => summary(pool, row, user!))) });
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id",
    access: "user",
    async handler({ params, user }) {
      return json(200, { project: await fullProject(pool, await projectFor(user!, params.id!), user!) });
    },
  },
  {
    method: "PATCH",
    path: "/api/projects/:id",
    access: "user",
    async handler({ params, body, user }) {
      const project = await transaction(async (client) => {
        const current = await projectFor(user!, params.id!, client, true);
        const fields = new Fields(body);
        const name = fields.has("name") ? fields.text("name", { max: 120 }) : current.name;
        const clientName = fields.has("client_name") ? fields.optionalText("client_name", 120) : current.client_name;
        const room = readRoom(fields);
        fields.done();
        const next = {
          ...current,
          name,
          client_name: clientName,
          ceiling_height_mm: room.ceiling ?? current.ceiling_height_mm,
          room_width_mm: room.width ?? current.room_width_mm,
          room_depth_mm: room.depth ?? current.room_depth_mm,
        };
        const outside = await client.query(
          "SELECT 1 FROM placements WHERE project_id = $1 AND (x_mm > $2 OR y_mm > $3) LIMIT 1",
          [current.id, next.room_width_mm, next.room_depth_mm],
        );
        if (outside.rowCount) throw apiError(409, "placements_outside_room");
        await client.query(
          `UPDATE projects SET name = $2, client_name = $3, ceiling_height_mm = $4, room_width_mm = $5, room_depth_mm = $6
           WHERE id = $1`,
          [current.id, next.name, next.client_name, next.ceiling_height_mm, next.room_width_mm, next.room_depth_mm],
        );
        return next;
      });
      return json(200, { project: await fullProject(pool, project, user!) });
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/lines",
    access: "user",
    async handler({ params, body, user }) {
      const project = await projectFor(user!, params.id!);
      const variant = typeof body.variant_code === "string" ? await variantByCode(body.variant_code) : null;
      if (typeof body.variant_code === "string" && !variant) throw notFound("unknown_variant");
      const fields = new Fields(body);
      if (!variant) fields.fail("variant_code", "required");
      const quantity = fields.int("quantity", { min: 1, max: 999 });
      fields.done();
      await transaction(async (client) => {
        const existing = await client.query<{ quantity: number }>(
          "SELECT quantity FROM project_lines WHERE project_id = $1 AND variant_code = $2 FOR UPDATE",
          [project.id, variant!.code],
        );
        const total = (existing.rows[0]?.quantity ?? 0) + quantity;
        if (total > 999) fields.fail("quantity", "out_of_range");
        fields.done();
        await client.query(
          `INSERT INTO project_lines (project_id, variant_code, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (project_id, variant_code) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [project.id, variant!.code, total],
        );
      });
      return json(200, { project: await fullProject(pool, project, user!) });
    },
  },
  {
    method: "PATCH",
    path: "/api/projects/:id/lines/:code",
    access: "user",
    async handler({ params, body, user }) {
      const project = await projectFor(user!, params.id!);
      await transaction(async (client) => {
        const line = await client.query<{ quantity: number }>(
          "SELECT quantity FROM project_lines WHERE project_id = $1 AND variant_code = $2 FOR UPDATE",
          [project.id, params.code],
        );
        if (!line.rowCount) throw notFound();
        const fields = new Fields(body);
        const quantity = fields.int("quantity", { min: 0, max: 999 });
        const placed = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM placements WHERE project_id = $1 AND variant_code = $2",
          [project.id, params.code],
        );
        if (fields.has("quantity") && quantity < placed.rows[0]!.count) throw apiError(409, "placement_exceeds_quantity");
        fields.done();
        if (quantity === 0) {
          await client.query("DELETE FROM project_lines WHERE project_id = $1 AND variant_code = $2", [project.id, params.code]);
        } else {
          await client.query("UPDATE project_lines SET quantity = $3 WHERE project_id = $1 AND variant_code = $2", [
            project.id,
            params.code,
            quantity,
          ]);
        }
      });
      return json(200, { project: await fullProject(pool, project, user!) });
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/cover",
    access: "user",
    multipart: true,
    async handler({ req, raw, params, user }) {
      const project = await projectFor(user!, params.id!);
      const image = imagePart(req, raw);
      if (!image) throw validation({ image: "required" });
      if (image.length > COVER_LIMIT) throw apiError(413, "payload_too_large");
      const kind = IMAGE_TYPES.find((candidate) => candidate.test(image));
      if (!kind) throw validation({ image: "unsupported_type" });
      const key = `covers/${project.id}/${randomUUID()}.${kind.ext}`;
      await putConfirmed(key, image, kind.type);
      await pool.query("UPDATE projects SET cover_key = $2 WHERE id = $1", [project.id, key]);
      return json(201, { cover: { status: "ready", url: `/api/projects/${project.id}/cover?v=${key.split("/").pop()}` } });
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/cover",
    access: "user",
    async handler({ params, user }) {
      const project = await projectFor(user!, params.id!);
      const stored = project.cover_key ? await getObject(project.cover_key) : null;
      if (!stored) throw notFound();
      return { status: 200, file: stored.data, contentType: stored.contentType };
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/placements",
    access: "user",
    async handler({ params, body, user }) {
      const code = typeof body.variant_code === "string" ? body.variant_code : "";
      const { project, id, x, y } = await transaction(async (client) => {
        const project = await projectFor(user!, params.id!, client, true);
        const line = await client.query<{ quantity: number }>(
          "SELECT quantity FROM project_lines WHERE project_id = $1 AND variant_code = $2 FOR UPDATE",
          [project.id, code],
        );
        const placed = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM placements WHERE project_id = $1 AND variant_code = $2",
          [project.id, code],
        );
        if (placed.rows[0]!.count >= (line.rows[0]?.quantity ?? 0)) throw apiError(409, "placement_exceeds_quantity");
        const { x, y } = readCoordinates(body, project);
        const counter = await client.query<{ last_ordinal: number }>(
          `INSERT INTO placement_counters (project_id, variant_code, last_ordinal) VALUES ($1, $2, 1)
           ON CONFLICT (project_id, variant_code) DO UPDATE SET last_ordinal = placement_counters.last_ordinal + 1
           RETURNING last_ordinal`,
          [project.id, code],
        );
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO placements (project_id, variant_code, ordinal, x_mm, y_mm) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [project.id, code, counter.rows[0]!.last_ordinal, x, y],
        );
        return { project, id: inserted.rows[0]!.id, x, y };
      });
      const live = await recordPlacement(project.id, id, code, x, y, "created");
      return json(201, { placement: await placementById(pool, project, id), live });
    },
  },
  {
    method: "PATCH",
    path: "/api/projects/:id/placements/:pid",
    access: "user",
    async handler({ params, body, user }) {
      const project = await projectFor(user!, params.id!);
      const { x, y, code } = await transaction(async (client) => {
        const found = await client.query<{ variant_code: string }>(
          "SELECT variant_code FROM placements WHERE id::text = $1 AND project_id = $2 FOR UPDATE",
          [params.pid, project.id],
        );
        if (!found.rows[0]) throw notFound();
        const { x, y } = readCoordinates(body, project);
        await client.query("UPDATE placements SET x_mm = $2, y_mm = $3 WHERE id = $1", [params.pid, x, y]);
        return { x, y, code: found.rows[0].variant_code };
      });
      const live = await recordPlacement(project.id, params.pid!, code, x, y, "updated");
      return json(200, { placement: await placementById(pool, project, params.pid!), live });
    },
  },
  {
    method: "DELETE",
    path: "/api/projects/:id/placements/:pid",
    access: "user",
    async handler({ params, user }) {
      const project = await projectFor(user!, params.id!);
      const removed = await pool.query<{ variant_code: string; x_mm: number; y_mm: number }>(
        "DELETE FROM placements WHERE id::text = $1 AND project_id = $2 RETURNING variant_code, x_mm, y_mm",
        [params.pid, project.id],
      );
      const row = removed.rows[0];
      if (!row) throw notFound();
      await recordPlacement(project.id, params.pid!, row.variant_code, row.x_mm, row.y_mm, "deleted");
      return json(204);
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/collaborators",
    access: "user",
    async handler({ params, body, user }) {
      const project = await projectFor(user!, params.id!);
      ownerOnly(user!, project);
      const fields = new Fields(body);
      const email = fields.email("email");
      fields.done();
      const found = await pool.query<{ id: string; name: string; email: string }>(
        `SELECT id, name, email FROM users WHERE lower(email) = $1 AND role = 'trade' AND trade_status = 'approved' AND id <> $2`,
        [email, project.owner_id],
      );
      const collaborator = found.rows[0];
      if (!collaborator) throw validation({ email: "not_a_trade_account" });
      await pool.query(
        "INSERT INTO project_collaborators (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [project.id, collaborator.id],
      );
      return json(201, { collaborator: { user_id: collaborator.id, name: collaborator.name, email: collaborator.email } });
    },
  },
  {
    method: "DELETE",
    path: "/api/projects/:id/collaborators/:userId",
    access: "user",
    async handler({ params, user }) {
      const project = await projectFor(user!, params.id!);
      ownerOnly(user!, project);
      await pool.query("DELETE FROM project_collaborators WHERE project_id = $1 AND user_id::text = $2", [
        project.id,
        params.userId,
      ]);
      return json(204);
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/comments",
    access: "user",
    async handler({ params, user }) {
      const project = await projectFor(user!, params.id!);
      return json(200, { comments: await listComments(project.id) });
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/comments",
    access: "user",
    async handler({ params, body, user }) {
      const project = await projectFor(user!, params.id!);
      const fields = new Fields(body);
      const text = typeof body.body === "string" ? body.body : "";
      if (!text.trim()) fields.fail("body", "required");
      else if (text.length > 2000) fields.fail("body", "too_long");
      fields.done();
      return json(201, { comment: await postComment(project.id, user!.id, user!.name, text) });
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/live",
    access: "user",
    async handler({ params, user, res }) {
      const project = await projectFor(user!, params.id!);
      openStream(project.id, user!.id, user!.name, res);
      return STREAMING;
    },
  },
  {
    method: "POST",
    path: "/api/projects/:id/shares",
    access: "user",
    async handler({ params, body, user }) {
      const project = await projectFor(user!, params.id!);
      ownerOnly(user!, project);
      const fields = new Fields(body);
      const recipients = Array.isArray(body.recipients) ? body.recipients : null;
      if (!recipients) fields.fail("recipients", "required");
      else if (recipients.length < 1 || recipients.length > 10) fields.fail("recipients", "out_of_range");
      else if (!recipients.every((r) => typeof r === "string" && isEmail(r.trim()))) fields.fail("recipients", "invalid");
      const display = fields.choice("price_display", ["trade", "retail", "none"] as const);
      const message = fields.optionalText("message", 1000);
      fields.done();
      const created = await pool.query<Share>(
        `INSERT INTO shares AS s (project_id, sender_id, price_display, recipients, message)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${SHARE_COLUMNS}`,
        [project.id, user!.id, display, (recipients as string[]).map((r) => r.trim().toLowerCase()), message],
      );
      kickShares();
      return json(201, { share: share(created.rows[0]!) });
    },
  },
  {
    method: "GET",
    path: "/api/projects/:id/shares",
    access: "user",
    async handler({ params, user }) {
      const project = await projectFor(user!, params.id!);
      const rows = await pool.query<Share>(
        `SELECT ${SHARE_COLUMNS} FROM shares s WHERE s.project_id = $1 ORDER BY s.created_at`,
        [project.id],
      );
      return json(200, { shares: rows.rows.map(share) });
    },
  },
  {
    method: "GET",
    path: "/api/shares/:shareId/pdf",
    access: "user",
    async handler({ params, user }) {
      if (!UUID.test(params.shareId!)) throw notFound();
      const found = await pool.query<{ project_id: string; pdf_status: string }>(
        "SELECT project_id, pdf_status FROM shares WHERE id = $1",
        [params.shareId],
      );
      const row = found.rows[0];
      if (!row) throw notFound();
      const project = await projectFor(user!, row.project_id);
      if (row.pdf_status !== "ready") throw apiError(409, "pdf_not_ready");
      const stored = await getObject(`quotes/${project.id}/${params.shareId}.pdf`);
      if (!stored) throw notFound();
      return {
        status: 200,
        file: stored.data,
        contentType: "application/pdf",
        headers: { "Content-Disposition": `inline; filename="lightfall-quote-${params.shareId}.pdf"` },
      };
    },
  },
];
