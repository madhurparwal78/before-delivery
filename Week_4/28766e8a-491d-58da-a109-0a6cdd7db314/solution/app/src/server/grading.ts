// Grading routes (brief: Grading routes): present only when GRADING_ROUTES is on; no session needed.
import { ApiError, requireFields } from "../shared/errors";
import { routePage } from "../shared/router";
import { emailError, LIMITS, nameError, normaliseEmail, passwordError, titleError } from "../shared/text";
import type { Connector, DiagramDocument, Layer, Page, Port, Shape, ShapeKind } from "../shared/types";
import { createUser, emailTaken } from "./auth";
import { config } from "./config";
import { pool, transaction } from "./db";
import { insertDiagram } from "./diagrams";
import { json, objectBody, route, type Request } from "./http";
import { newId } from "./ids";
import { closeDiagram } from "./live";
import { startOutage } from "./operations";

const KINDS: readonly ShapeKind[] = ["rectangle", "ellipse", "diamond", "text"];
const PORT_NAMES: readonly Port[] = ["n", "e", "s", "w"];

type Json = Record<string, unknown>;

function list(value: unknown): Json[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "object" && v !== null)) throw new ApiError("invalid");
  return value as Json[];
}

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) throw new ApiError("invalid");
  return value;
}

function int(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ApiError("invalid");
  return value;
}

interface SeededPage {
  page: Page;
  comments: { shape: string; page: string; author: string; text: string; label: string }[];
}

function buildPage(raw: Json, index: number, users: Map<string, string>): SeededPage {
  const layersRaw = list(raw.layers);
  if (!layersRaw.length || layersRaw.length > LIMITS.layersPerPage) throw new ApiError("invalid");
  const layers: Layer[] = layersRaw.map((l, order) => ({
    id: newId("l_"), name: text(l.name, 1, LIMITS.layerName), order, visible: l.visible !== false, locked: l.locked === true,
  }));
  const layerByName = new Map(layers.map((l) => [l.name, l]));
  const shapes: Shape[] = [];
  const byLabel = new Map<string, Shape>();
  for (const s of list(raw.shapes)) {
    const layer = layerByName.get(String(s.layer));
    if (!layer || !KINDS.includes(s.kind as ShapeKind)) throw new ApiError("invalid");
    const shape: Shape = {
      id: newId("s_"), kind: s.kind as ShapeKind, layer: layer.id,
      x: int(s.x, -20000, 20000), y: int(s.y, -20000, 20000), w: int(s.w, 24, 2000), h: int(s.h, 24, 2000),
      label: text(s.label ?? "", 0, LIMITS.label), z: shapes.filter((o) => o.layer === layer.id).length, group: null,
    };
    if (shape.label && byLabel.has(shape.label)) throw new ApiError("invalid");
    if (shape.label) byLabel.set(shape.label, shape);
    shapes.push(shape);
  }
  const end = (value: unknown): { shape: Shape; port: Port } => {
    const e = (value ?? {}) as Json;
    const shape = byLabel.get(String(e.shape));
    if (!shape || !PORT_NAMES.includes(e.port as Port)) throw new ApiError("invalid");
    return { shape, port: e.port as Port };
  };
  const connectors: Connector[] = list(raw.connectors ?? []).map((c) => {
    const from = end(c.from);
    const to = end(c.to);
    if (from.shape.id === to.shape.id) throw new ApiError("invalid");
    return { id: newId("c_"), layer: from.shape.layer, from: { shape: from.shape.id, port: from.port }, to: { shape: to.shape.id, port: to.port }, label: text(c.label ?? "", 0, LIMITS.label), route: [] };
  });
  const groups = list(raw.groups ?? []).map((g) => {
    const members = (Array.isArray(g.members) ? g.members : []).map((label) => byLabel.get(String(label)));
    if (members.length < 2 || members.some((m) => !m || m.group) || new Set(members.map((m) => m?.layer)).size !== 1) throw new ApiError("invalid");
    const id = newId("g_");
    for (const m of members as Shape[]) m.group = id;
    return { id, members: (members as Shape[]).map((m) => m.id) };
  });
  const page: Page = { id: newId("p_"), name: text(raw.name, 1, LIMITS.pageName), order: index, layers, shapes, connectors, groups };
  const routes = routePage(page);
  for (const c of page.connectors) c.route = routes.get(c.id)?.route ?? [];
  const comments = list(raw.comments ?? []).map((c) => {
    const shape = byLabel.get(String(c.shape));
    const author = users.get(normaliseEmail(String(c.author ?? "")));
    if (!shape || !author) throw new ApiError("invalid");
    return { shape: shape.id, page: page.id, author, text: text(c.text, 1, LIMITS.comment), label: shape.label };
  });
  return { page, comments };
}

async function existingUsers(emails: string[]): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE email = ANY($1)", [emails]);
  return new Map(rows.map((r) => [r.email, r.id]));
}

function gate(req: Request): void {
  if (!config.gradingRoutes || req.method !== "POST") throw new ApiError("not_found");
}

route("POST", "/api/grading/seed", async (req) => {
  gate(req);
  const body = objectBody(req.body);
  const usersRaw = list(body.users ?? []);
  const diagramsRaw = list(body.diagrams ?? []);
  for (const u of usersRaw) if (emailError(u.email) === null && (await emailTaken(pool, u.email as string))) throw new ApiError("email_taken");
  requireFields(Object.fromEntries(usersRaw.flatMap((u, i) => [
    [`users.${i}.email`, emailError(u.email)], [`users.${i}.name`, nameError(u.name)], [`users.${i}.password`, passwordError(u.password)]])));
  requireFields(Object.fromEntries(diagramsRaw.map((d, i) => [`diagrams.${i}.title`, titleError(d.title)])));
  const emails = usersRaw.map((u) => normaliseEmail(u.email as string));
  if (new Set(emails).size !== emails.length) throw new ApiError("invalid");

  return transaction(async (db) => {
    const users = await existingUsers(diagramsRaw.flatMap((d) => [String(d.owner ?? ""), ...list(d.members ?? []).map((m) => String(m.email ?? ""))]).map(normaliseEmail));
    const createdUsers = [];
    for (const u of usersRaw) {
      const user = await createUser(db, u.email as string, u.name as string, u.password as string);
      users.set(user.email, user.id);
      createdUsers.push({ id: user.id, email: user.email });
    }
    const createdDiagrams = [];
    for (const d of diagramsRaw) {
      const owner = users.get(normaliseEmail(String(d.owner ?? "")));
      if (!owner) throw new ApiError("invalid");
      const pagesRaw = list(((d.document ?? {}) as Json).pages ?? []);
      if (!pagesRaw.length || pagesRaw.length > LIMITS.pagesPerDiagram) throw new ApiError("invalid");
      const seeded = pagesRaw.map((p, i) => buildPage(p, i, users));
      const doc: DiagramDocument = { id: newId("d_"), title: d.title as string, seq: 0, pages: seeded.map((s) => s.page) };
      await insertDiagram(db, doc, owner);
      for (const m of list(d.members ?? [])) {
        const member = users.get(normaliseEmail(String(m.email ?? "")));
        if (!member || (m.role !== "editor" && m.role !== "viewer") || member === owner) throw new ApiError("invalid");
        await db.query("INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)", [doc.id, member, m.role]);
      }
      const pages = [];
      for (const s of seeded) {
        const commentIds: Record<string, string[]> = {};
        for (const c of s.comments) {
          const id = newId("m_");
          await db.query("INSERT INTO comments (id, diagram_id, shape_id, page_id, author_id, text) VALUES ($1, $2, $3, $4, $5, $6)", [id, doc.id, c.shape, c.page, c.author, c.text]);
          (commentIds[c.label] ??= []).push(id);
        }
        const labels = new Map(s.page.shapes.map((sh) => [sh.id, sh.label]));
        pages.push({
          id: s.page.id, name: s.page.name,
          layers: Object.fromEntries(s.page.layers.map((l) => [l.name, l.id])),
          shapes: Object.fromEntries(s.page.shapes.filter((sh) => sh.label).map((sh) => [sh.label, sh.id])),
          connectors: Object.fromEntries(s.page.connectors.map((c) => [`${labels.get(c.from.shape)}->${labels.get(c.to.shape)}`, c.id])),
          comments: commentIds,
        });
      }
      createdDiagrams.push({ id: doc.id, pages });
    }
    return json(201, { users: createdUsers, diagrams: createdDiagrams });
  });
});

route("POST", "/api/grading/save-outage", async (req) => {
  gate(req);
  const { diagramId, ms } = objectBody(req.body);
  if (typeof diagramId !== "string" || typeof ms !== "number" || !Number.isInteger(ms) || ms < 1 || ms > 60000) throw new ApiError("invalid");
  const until = startOutage(diagramId, ms);
  closeDiagram(diagramId);
  return json(200, { until: new Date(until).toISOString() });
});
