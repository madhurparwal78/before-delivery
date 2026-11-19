import { randomBytes, randomUUID } from "node:crypto";
import { type Db, one, query, transaction } from "../db.js";
import { fail, invalid, notFound, parseMultipart, sendJson } from "../http.js";
import { checkStem, CONTENT_TYPES } from "../media.js";
import type { Context, Route } from "../router.js";
import { deleteObject, objectExists, putObject } from "../storage.js";
import { asObject, Checker, isSingleLine, nonEmpty } from "../validate.js";
import { CREDIT_TYPES, type CreditType, type Layer, LAYERS } from "../../shared/credits.js";
import { LINKABLE, PROJECT_MOVES, PROJECT_WRITABLE, type ProjectStatus } from "../../shared/lifecycle.js";

type Visibility = "public" | "nda";

export interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: Visibility;
  position: number;
  threshold_pulse: number;
  threshold_lead: number;
  threshold_stinger: number;
  status: ProjectStatus;
}

export interface StemRow {
  id: string;
  project_id: string;
  layer: Layer;
  format: "wav" | "ogg";
  bytes: number;
  duration_ms: number;
  object_key: string;
}

interface Thresholds {
  bed: number;
  pulse: number;
  lead: number;
  stinger: number;
}

/** The visibility rule: a public project shows in the journey, search and public stem URLs only while published. */
export const PUBLIC_STATION = "p.status = 'published' AND p.visibility = 'public'";

const PROJECT_STATUSES = Object.keys(PROJECT_MOVES) as ProjectStatus[];

export const PROJECT_COLUMNS = `p.id, p.slug, p.title, p.credit_type, p.credit_line, p.role, p.blurb, p.tags, p.visibility,
  p.position, p.threshold_pulse, p.threshold_lead, p.threshold_stinger, p.status`;

export function thresholdsOf(row: ProjectRow): Thresholds {
  return { bed: 0, pulse: row.threshold_pulse, lead: row.threshold_lead, stinger: row.threshold_stinger };
}

export function stemKey(projectId: string, stemId: string, format: string): string {
  return `projects/${projectId}/stems/${stemId}.${format}`;
}

export async function stemsOf(projectIds: string[], db?: Db): Promise<Map<string, StemRow[]>> {
  const rows = projectIds.length === 0 ? [] : await query<StemRow>(
    "SELECT id, project_id, layer, format, bytes, duration_ms, object_key FROM stems WHERE project_id = ANY($1::uuid[])",
    [projectIds],
    db,
  );
  const grouped = new Map<string, StemRow[]>(projectIds.map((id) => [id, []]));
  for (const row of rows) grouped.get(row.project_id)?.push(row);
  for (const list of grouped.values()) list.sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer));
  return grouped;
}

function toProject(row: ProjectRow, stems: StemRow[]) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    credit_type: row.credit_type,
    credit_line: row.credit_line,
    role: row.role,
    blurb: row.blurb,
    tags: row.tags,
    visibility: row.visibility,
    position: row.position,
    thresholds: thresholdsOf(row),
    status: row.status,
    stems: stems.map((stem) => ({
      id: stem.id, layer: stem.layer, format: stem.format, bytes: stem.bytes, duration_ms: stem.duration_ms,
    })),
  };
}

async function projectRow(id: string, db?: Db, lock = false): Promise<ProjectRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await one<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
  if (!row) notFound();
  return row;
}

async function sendProject(res: Context["res"], status: number, id: string): Promise<void> {
  const row = await projectRow(id);
  const stems = (await stemsOf([id])).get(id) ?? [];
  sendJson(res, status, { project: toProject(row, stems) });
}

/** Validates the writable project fields present in `check.body` and returns the normalised values. */
function projectFields(check: Checker): Partial<ProjectRow> {
  const fields: Partial<ProjectRow> = {};
  const body = check.body;
  if (check.has("slug")) {
    if (typeof body.slug !== "string" || !/^[a-z0-9-]{3,48}$/.test(body.slug)) {
      check.error("slug", "Use 3 to 48 lowercase letters, digits and hyphens.");
    } else fields.slug = body.slug;
  }
  if (check.has("title")) fields.title = check.singleLine("title", 1, 120);
  if (check.has("credit_type")) {
    if (!CREDIT_TYPES.includes(body.credit_type as CreditType)) check.error("credit_type", "Choose shipped, jam or redesign.");
    else fields.credit_type = body.credit_type as CreditType;
  }
  if (check.has("credit_line")) fields.credit_line = check.singleLine("credit_line", 1, 200);
  if (check.has("role")) fields.role = check.singleLine("role", 1, 120);
  if (check.has("blurb")) fields.blurb = check.multiLine("blurb", 1, 1000);
  if (check.has("tags")) {
    const tags = body.tags;
    if (!Array.isArray(tags) || tags.length > 10
      || !tags.every((tag) => typeof tag === "string" && [...tag].length >= 1 && [...tag].length <= 30 && isSingleLine(tag))) {
      check.error("tags", "Use at most 10 tags of 1 to 30 characters, each on one line.");
    } else fields.tags = tags as string[];
  }
  if (check.has("visibility")) {
    if (body.visibility !== "public" && body.visibility !== "nda") check.error("visibility", "Choose public or nda.");
    else fields.visibility = body.visibility;
  }
  if (check.has("position")) fields.position = check.integer("position", 1, 999);
  if (check.has("thresholds")) {
    const t = body.thresholds as Record<string, unknown> | null;
    const keys = t && typeof t === "object" && !Array.isArray(t) ? Object.keys(t).sort().join(",") : "";
    const values = LAYERS.map((layer) => t?.[layer]);
    const valid = keys === "bed,lead,pulse,stinger" && values[0] === 0
      && values.slice(1).every((v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100)
      && (values as number[]).every((v, i, all) => i === 0 || v > (all[i - 1] ?? 0));
    if (!valid) check.error("thresholds", "Bed is 0; pulse, lead and stinger rise strictly from 1 to 100.");
    else [fields.threshold_pulse, fields.threshold_lead, fields.threshold_stinger] = values.slice(1) as number[];
  }
  return fields;
}

function slugTaken(error: unknown): boolean {
  return (error as { code?: string; constraint?: string }).code === "23505";
}

async function listProjects({ res }: Context): Promise<void> {
  const rows = await query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects p ORDER BY p.position, p.title`);
  const stems = await stemsOf(rows.map((row) => row.id));
  sendJson(res, 200, { projects: rows.map((row) => toProject(row, stems.get(row.id) ?? [])) });
}

async function getProject({ res, params }: Context): Promise<void> {
  await sendProject(res, 200, params.id ?? "");
}

async function createProject({ res, json }: Context): Promise<void> {
  const check = new Checker(asObject(json)).writable(PROJECT_WRITABLE);
  for (const key of ["slug", "title", "credit_type", "credit_line", "role", "blurb"]) {
    if (!check.has(key)) check.error(key, "This field is required.");
  }
  const fields = projectFields(check);
  check.done();
  const id = randomUUID();
  try {
    await query(
      `INSERT INTO projects (id, slug, title, credit_type, credit_line, role, blurb, tags, visibility, position,
         threshold_pulse, threshold_lead, threshold_stinger, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
         COALESCE($10, (SELECT CASE WHEN COALESCE(max(position), 0) < 999 THEN COALESCE(max(position), 0) + 1
                          ELSE (SELECT min(n) FROM generate_series(1, 999) n WHERE n NOT IN (SELECT position FROM projects)) END
                        FROM projects)),
         $11, $12, $13, 'draft')`,
      [id, fields.slug, fields.title, fields.credit_type, fields.credit_line, fields.role, fields.blurb,
        fields.tags ?? [], fields.visibility ?? "public", fields.position ?? null,
        fields.threshold_pulse ?? 25, fields.threshold_lead ?? 50, fields.threshold_stinger ?? 75],
    );
  } catch (error) {
    if (slugTaken(error)) fail(409, "slug_taken", "That slug is already used.");
    throw error;
  }
  await sendProject(res, 201, id);
}

const COLUMN_FOR: Record<string, string> = {
  slug: "slug", title: "title", credit_type: "credit_type", credit_line: "credit_line", role: "role", blurb: "blurb",
  tags: "tags", visibility: "visibility", position: "position",
  threshold_pulse: "threshold_pulse", threshold_lead: "threshold_lead", threshold_stinger: "threshold_stinger",
};

async function patchProject({ res, json, params }: Context): Promise<void> {
  const id = params.id ?? "";
  const row = await projectRow(id);
  if (row.status === "withdrawn") fail(409, "project_withdrawn", "A withdrawn project cannot be changed.");
  const check = new Checker(nonEmpty(json)).writable(PROJECT_WRITABLE);
  const fields = projectFields(check);
  check.done();
  const entries = Object.entries(fields);
  try {
    await query(
      `UPDATE projects SET ${entries.map(([key], i) => `${COLUMN_FOR[key]} = $${i + 2}`).join(", ")} WHERE id = $1`,
      [id, ...entries.map(([, value]) => value)],
    );
  } catch (error) {
    if (slugTaken(error)) fail(409, "slug_taken", "That slug is already used.");
    throw error;
  }
  await sendProject(res, 200, id);
}

async function uploadStem({ res, params, raw, req }: Context): Promise<void> {
  const id = params.id ?? "";
  const project = await projectRow(id);
  if (project.status === "withdrawn") fail(409, "project_withdrawn", "A withdrawn project cannot take stems.");
  const form = parseMultipart(req.headers["content-type"], raw);
  if (!form) invalid({ file: "Send the stem as multipart form data." });
  const file = form.files.get("file");
  const layer = form.fields.get("layer") as Layer | undefined;
  const info = file ? checkStem("file", file.filename, file.data) : null;
  const errors: Record<string, string> = {};
  if (!layer || !LAYERS.includes(layer)) errors.layer = "Choose bed, pulse, lead or stinger.";
  if (!file || !info) errors.file = "Choose a WAV or OGG file.";
  if (Object.keys(errors).length > 0 || !file || !info || !layer) invalid(errors);
  const stemId = randomUUID();
  const key = stemKey(id, stemId, info.format);
  await putObject(key, file.data, CONTENT_TYPES[info.format]);
  const replaced = await transaction(async (client) => {
    const current = await projectRow(id, client, true);
    if (current.status === "withdrawn") return null;
    const old = await one<{ object_key: string }>(
      "SELECT object_key FROM stems WHERE project_id = $1 AND layer = $2 FOR UPDATE",
      [id, layer],
      client,
    );
    await client.query("DELETE FROM stems WHERE project_id = $1 AND layer = $2", [id, layer]);
    await client.query(
      `INSERT INTO stems (id, project_id, layer, format, bytes, duration_ms, object_key) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [stemId, id, layer, info.format, file.data.length, info.durationMs, key],
    );
    return { old: old?.object_key ?? null };
  }).catch(async (error: unknown) => {
    await deleteObject(key).catch(() => undefined);
    throw error;
  });
  if (!replaced) {
    await deleteObject(key).catch(() => undefined);
    fail(409, "project_withdrawn", "A withdrawn project cannot take stems.");
  }
  if (replaced.old) await deleteObject(replaced.old).catch(() => undefined);
  sendJson(res, 201, {
    stem: { id: stemId, layer, format: info.format, bytes: file.data.length, duration_ms: info.durationMs },
  });
}

async function moveProject({ res, json, params }: Context): Promise<void> {
  const id = params.id ?? "";
  await projectRow(id);
  const check = new Checker(asObject(json)).writable(["to"]);
  const to = check.body.to as ProjectStatus;
  if (!PROJECT_STATUSES.includes(to)) check.error("to", "Choose draft, in_review, published or withdrawn.");
  check.done();
  await transaction(async (client) => {
    const row = await projectRow(id, client, true);
    if (!PROJECT_MOVES[row.status].includes(to)) {
      fail(409, "illegal_transition", "That move isn’t allowed from the current state.", { from: row.status, to });
    }
    const stems = (await stemsOf([id], client)).get(id) ?? [];
    if (to === "published") {
      const missing = LAYERS.filter((layer) => !stems.some((stem) => stem.layer === layer));
      if (missing.length > 0) fail(409, "stems_incomplete", "Upload the missing stems first.", { missing });
      for (const stem of stems) {
        if (!(await objectExists(stem.object_key))) {
          fail(409, "stems_incomplete", "Upload the missing stems first.", { missing: [stem.layer] });
        }
      }
    }
    if (to === "withdrawn") {
      for (const stem of stems) await deleteObject(stem.object_key);
      await client.query("DELETE FROM stems WHERE project_id = $1", [id]);
      await client.query("UPDATE listening_links SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL", [id]);
    }
    await client.query("UPDATE projects SET status = $2 WHERE id = $1", [id, to]);
  });
  await sendProject(res, 200, id);
}

// ---- Listening links ----

interface LinkRow {
  id: string;
  project_id: string;
  label: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
}

type LinkStatus = "active" | "expired" | "revoked";

/** Link status: revoked beats expired; expired from the expiry instant, to the millisecond. */
export function linkStatus(link: { expires_at: Date; revoked_at: Date | null }, now = Date.now()): LinkStatus {
  if (link.revoked_at) return "revoked";
  return now >= link.expires_at.getTime() ? "expired" : "active";
}

const LINK_MAX_SECONDS = 31_536_000;

function toLink(row: LinkRow) {
  return {
    id: row.id,
    label: row.label,
    token: row.token,
    url: `/listen/${row.token}`,
    expires_at: row.expires_at.toISOString(),
    status: linkStatus(row),
  };
}

const newToken = (): string => randomBytes(24).toString("base64url");

async function createLink({ res, json, params }: Context): Promise<void> {
  const project = await projectRow(params.id ?? "");
  if (!LINKABLE.includes(project.status)) {
    fail(409, "illegal_transition", "Links are only for projects in review or published.", { from: project.status });
  }
  const check = new Checker(asObject(json)).writable(["label", "expires_at"]);
  const label = check.singleLine("label", 1, 80);
  const raw = check.body.expires_at;
  const expires = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : null;
  const now = Date.now();
  if (!expires || Number.isNaN(expires.getTime()) || expires.getTime() <= now || expires.getTime() > now + LINK_MAX_SECONDS * 1000) {
    check.error("expires_at", "Choose an expiry after now and at most 365 days ahead.");
  }
  check.done();
  const row = await one<LinkRow>(
    `INSERT INTO listening_links (id, project_id, label, token, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [randomUUID(), project.id, label, newToken(), expires],
  );
  if (!row) notFound();
  sendJson(res, 201, { link: toLink(row) });
}

async function listLinks({ res, params }: Context): Promise<void> {
  const project = await projectRow(params.id ?? "");
  const rows = await query<LinkRow>("SELECT * FROM listening_links WHERE project_id = $1 ORDER BY created_at DESC", [project.id]);
  sendJson(res, 200, { links: rows.map(toLink) });
}

async function linkRow(id: string, db: Db): Promise<LinkRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await one<LinkRow>("SELECT * FROM listening_links WHERE id = $1 FOR UPDATE", [id], db);
  if (!row) notFound();
  return row;
}

async function revokeLink({ res, json, params }: Context): Promise<void> {
  new Checker(asObject(json)).writable([]).done();
  const row = await transaction(async (client) => {
    const link = await linkRow(params.id ?? "", client);
    return (await one<LinkRow>(
      "UPDATE listening_links SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING *",
      [link.id],
      client,
    )) as LinkRow;
  });
  sendJson(res, 200, { link: toLink(row) });
}

async function regenerateLink({ res, json, params }: Context): Promise<void> {
  new Checker(asObject(json)).writable([]).done();
  const fresh = await transaction(async (client) => {
    const link = await linkRow(params.id ?? "", client);
    if (linkStatus(link) !== "active") fail(409, "link_not_active", "Only an active link can be regenerated.");
    await client.query("UPDATE listening_links SET revoked_at = now() WHERE id = $1", [link.id]);
    return (await one<LinkRow>(
      `INSERT INTO listening_links (id, project_id, label, token, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), link.project_id, link.label, newToken(), link.expires_at],
      client,
    )) as LinkRow;
  });
  sendJson(res, 201, { link: toLink(fresh) });
}

export const projectRoutes: Route[] = [
  { pattern: "/api/console/projects", methods: { GET: { handler: listProjects }, POST: { handler: createProject } } },
  { pattern: "/api/console/projects/:id", methods: { GET: { handler: getProject }, PATCH: { handler: patchProject } } },
  { pattern: "/api/console/projects/:id/stems", methods: { POST: { handler: uploadStem, body: "stem" } } },
  { pattern: "/api/console/projects/:id/transition", methods: { POST: { handler: moveProject } } },
  { pattern: "/api/console/projects/:id/links", methods: { GET: { handler: listLinks }, POST: { handler: createLink } } },
  { pattern: "/api/console/links/:id/revoke", methods: { POST: { handler: revokeLink } } },
  { pattern: "/api/console/links/:id/regenerate", methods: { POST: { handler: regenerateLink } } },
];
