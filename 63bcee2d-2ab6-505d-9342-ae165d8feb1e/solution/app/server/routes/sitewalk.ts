import { randomUUID } from "node:crypto";
import { isStudio, requireRole, type Member, type Role } from "../auth.js";
import { one, pool, rows, tx, type Db } from "../db.js";
import { assertMovable, checkObservedOn, SNAG_ACTIONS, snagActions, snagTransition, type SnagState } from "../domain/snags.js";
import { forbidden, notFound, validation } from "../http/errors.js";
import { ok, type Ctx, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { holdsContract, knownId, visibleProject, type Project } from "../scope.js";
import { acceptFile, CONTENT_TYPE, fileHeaders } from "../services/files.js";
import { cleanPhoto } from "../services/images.js";
import { deleteObject, getObject, putObject } from "../services/storage.js";

// Site walk: viewpoints with their approved render and latest site photo, and the snags pinned on the
// Intent seam (brief: Viewpoints and snags).

const EDITORS: Role[] = ["director", "project_lead", "designer"];

interface ViewpointRow {
  id: string;
  project_id: string;
  name: string;
  store_code: string;
  render_extension: string | null;
  render_content_type: string | null;
}

interface SnagRow {
  id: string;
  viewpoint_id: string;
  number: number;
  s: number;
  y: number;
  title: string;
  note: string;
  observed_on: string;
  state: SnagState;
  version: number;
}

/** Studio roles and the contractor holding the contract see the site walk; anyone else who sees the project gets 403. */
function canViewSiteWalk(member: Member, project: Project): void {
  if (!isStudio(member) && !holdsContract(member, project)) throw forbidden();
}

async function viewpointFor(db: Db, member: Member, id: string, lock = false): Promise<{ viewpoint: ViewpointRow; project: Project }> {
  const viewpoint = await one<ViewpointRow>(db,
    `SELECT id, project_id, name, store_code, render_extension, render_content_type FROM viewpoints WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
    [knownId(id)]);
  if (!viewpoint) throw notFound();
  const project = await visibleProject(db, member, viewpoint.project_id);
  canViewSiteWalk(member, project);
  return { viewpoint, project };
}

async function snagFor(db: Db, member: Member, id: string): Promise<{ snag: SnagRow; project: Project }> {
  const snag = await one<SnagRow>(db, "SELECT * FROM snags WHERE id = $1 FOR UPDATE", [knownId(id)]);
  if (!snag) throw notFound();
  const { project } = await viewpointFor(db, member, snag.viewpoint_id);
  return { snag, project };
}

const latestPhoto = (db: Db, viewpointId: string) => one<{ id: string; extension: string; content_type: string }>(db,
  "SELECT id, extension, content_type FROM photos WHERE viewpoint_id = $1 ORDER BY uploaded_at DESC, id LIMIT 1", [viewpointId]);

async function viewpointJson(db: Db, viewpoint: ViewpointRow) {
  const photo = await latestPhoto(db, viewpoint.id);
  return { id: viewpoint.id, name: viewpoint.name, storeCode: viewpoint.store_code, hasRender: viewpoint.render_extension !== null, photoId: photo?.id ?? null };
}

/** Who may make which snag transition: the studio editors any, a contractor holding the contract only fix. */
function permittedTransitions(member: Member, project: Project): (typeof SNAG_ACTIONS)[number][] {
  if (EDITORS.includes(member.role)) return [...SNAG_ACTIONS];
  return holdsContract(member, project) ? ["fix"] : [];
}

/** A snag with the moves open to the caller. */
const snagJson = (snag: SnagRow, member: Member, project: Project) => ({
  id: snag.id, number: snag.number, s: snag.s, y: snag.y, title: snag.title, note: snag.note, observedOn: snag.observed_on,
  state: snag.state, version: snag.version,
  actions: snagActions(snag.state, permittedTransitions(member, project), EDITORS.includes(member.role)),
});

const imageUpload = (ctx: Ctx, fields: Fields, label: string) => {
  const file = acceptFile(fields, ctx.multipart().files.file?.[0], label, true);
  fields.done();
  return file as NonNullable<typeof file>;
};

const servedImage = async (key: string, contentType: string) =>
  ({ status: 200, body: await getObject(key), headers: { ...fileHeaders(contentType), "Cache-Control": "no-store" } });

export const routes: Route[] = [
  {
    method: "GET", path: "/api/projects/:id/viewpoints", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      canViewSiteWalk(ctx.me, project);
      const list = await rows<ViewpointRow>(pool,
        "SELECT id, project_id, name, store_code, render_extension, render_content_type FROM viewpoints WHERE project_id = $1 ORDER BY created_at, name",
        [project.id]);
      return ok({ viewpoints: await Promise.all(list.map((viewpoint) => viewpointJson(pool, viewpoint))) });
    },
  },
  {
    method: "POST", path: "/api/projects/:id/viewpoints", auth: "member",
    handler: async (ctx) => {
      const project = await visibleProject(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, ...EDITORS);
      const body = record(ctx.json());
      const fields = new Fields(body);
      const name = fields.text("name", "Viewpoint name", { max: 120, oneLine: true });
      const storeCode = typeof body.storeCode === "string" ? body.storeCode : "";
      if (!project.stores.some((store) => store.code === storeCode)) fields.fail("storeCode", "Choose one of this project's stores.");
      fields.done();
      const created = await one<ViewpointRow>(pool,
        `INSERT INTO viewpoints (project_id, name, store_code) VALUES ($1, $2, $3)
         RETURNING id, project_id, name, store_code, render_extension, render_content_type`, [project.id, name, storeCode]);
      return ok({ viewpoint: created && (await viewpointJson(pool, created)) }, 201);
    },
  },
  {
    method: "PUT", path: "/api/viewpoints/:id/render", auth: "member", body: "multipart",
    handler: async (ctx) => {
      const { viewpoint, project } = await viewpointFor(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, ...EDITORS);
      const file = imageUpload(ctx, new Fields({}), "Render");
      const extension = file.kind === "jpg" ? "jpg" : "png";
      const key = `projects/${project.id}/viewpoints/${viewpoint.id}/render.${extension}`;
      await putObject(key, file.data, file.contentType);
      try {
        const saved = await one<ViewpointRow>(pool,
          `UPDATE viewpoints SET render_extension = $2, render_content_type = $3 WHERE id = $1
           RETURNING id, project_id, name, store_code, render_extension, render_content_type`, [viewpoint.id, extension, file.contentType]);
        return ok({ viewpoint: saved && (await viewpointJson(pool, saved)) });
      } catch (error) {
        if (viewpoint.render_extension !== extension) await deleteObject(key);
        throw error;
      }
    },
  },
  {
    method: "POST", path: "/api/viewpoints/:id/photos", auth: "member", body: "multipart",
    handler: async (ctx) => {
      const { viewpoint, project } = await viewpointFor(pool, ctx.me, ctx.params.id);
      requireRole(ctx.me, ...EDITORS);
      const file = imageUpload(ctx, new Fields({}), "Site photo");
      let cleaned: ReturnType<typeof cleanPhoto>;
      try {
        cleaned = cleanPhoto(file.data, file.kind === "jpg" ? "jpg" : "png");
      } catch {
        throw validation({ file: `${file.name} isn't a PNG or JPEG image.` });
      }
      const id = randomUUID();
      const extension = file.kind === "jpg" ? "jpg" : "png";
      const key = `projects/${project.id}/viewpoints/${viewpoint.id}/photos/${id}.${extension}`;
      await putObject(key, cleaned.data, CONTENT_TYPE[extension]);
      try {
        await pool.query("INSERT INTO photos (id, viewpoint_id, width, height, extension, content_type) VALUES ($1, $2, $3, $4, $5, $6)",
          [id, viewpoint.id, cleaned.width, cleaned.height, extension, CONTENT_TYPE[extension]]);
      } catch (error) {
        await deleteObject(key);
        throw error;
      }
      return ok({ photo: { id, width: cleaned.width, height: cleaned.height } }, 201);
    },
  },
  {
    method: "GET", path: "/api/viewpoints/:id/render", auth: "member",
    handler: async (ctx) => {
      const { viewpoint, project } = await viewpointFor(pool, ctx.me, ctx.params.id);
      if (!viewpoint.render_extension || !viewpoint.render_content_type) throw notFound();
      return servedImage(`projects/${project.id}/viewpoints/${viewpoint.id}/render.${viewpoint.render_extension}`, viewpoint.render_content_type);
    },
  },
  {
    method: "GET", path: "/api/viewpoints/:id/photo", auth: "member",
    handler: async (ctx) => {
      const { viewpoint, project } = await viewpointFor(pool, ctx.me, ctx.params.id);
      const photo = await latestPhoto(pool, viewpoint.id);
      if (!photo) throw notFound();
      return servedImage(`projects/${project.id}/viewpoints/${viewpoint.id}/photos/${photo.id}.${photo.extension}`, photo.content_type);
    },
  },
  {
    method: "GET", path: "/api/viewpoints/:id/snags", auth: "member",
    handler: async (ctx) => {
      const { viewpoint, project } = await viewpointFor(pool, ctx.me, ctx.params.id);
      const list = await rows<SnagRow>(pool, "SELECT * FROM snags WHERE viewpoint_id = $1 ORDER BY number", [viewpoint.id]);
      return ok({ snags: list.map((snag) => snagJson(snag, ctx.me, project)) });
    },
  },
  {
    method: "POST", path: "/api/viewpoints/:id/snags", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const { viewpoint, project } = await viewpointFor(client, member, ctx.params.id, true);
        requireRole(member, ...EDITORS);
        const fields = new Fields(record(ctx.json()));
        const s = fields.integer("s", "Across", 0, 100);
        const y = fields.integer("y", "Height", 0, 100);
        const title = fields.text("title", "Snag title", { max: 120 });
        const note = fields.text("note", "Note", { min: 0, max: 500 });
        const observedOn = fields.date("observedOn", "Observed on");
        checkObservedOn(fields, observedOn, project);
        fields.done();
        const next = await one<{ n: number }>(client, "SELECT coalesce(max(number), 0) + 1 AS n FROM snags WHERE viewpoint_id = $1", [viewpoint.id]);
        const snag = await one<SnagRow>(client,
          `INSERT INTO snags (viewpoint_id, number, s, y, title, note, observed_on, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
           RETURNING *`, [viewpoint.id, next?.n, s, y, title, note, observedOn]);
        return ok({ snag: snag && snagJson(snag, member, project) }, 201);
      });
    },
  },
  {
    method: "PATCH", path: "/api/snags/:id", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const { snag, project } = await snagFor(client, member, ctx.params.id);
        requireRole(member, ...EDITORS);
        const body = record(ctx.json());
        if (body.s !== undefined || body.y !== undefined) assertMovable(snag.state);
        const fields = new Fields(body);
        const s = body.s === undefined ? snag.s : fields.integer("s", "Across", 0, 100);
        const y = body.y === undefined ? snag.y : fields.integer("y", "Height", 0, 100);
        const title = body.title === undefined ? snag.title : fields.text("title", "Snag title", { max: 120 });
        const note = body.note === undefined ? snag.note : fields.text("note", "Note", { min: 0, max: 500 });
        fields.done();
        const saved = await one<SnagRow>(client,
          "UPDATE snags SET s = $2, y = $3, title = $4, note = $5, version = version + 1 WHERE id = $1 RETURNING *",
          [snag.id, s, y, title, note]);
        return ok({ snag: saved && snagJson(saved, member, project) });
      });
    },
  },
  {
    method: "POST", path: "/api/snags/:id/transitions", auth: "member",
    handler: async (ctx) => {
      const member = ctx.me;
      return tx(async (client) => {
        const { snag, project } = await snagFor(client, member, ctx.params.id);
        const body = record(ctx.json());
        const action = SNAG_ACTIONS.find((known) => known === body.action);
        const permitted = permittedTransitions(member, project);
        // An unknown action is checked against the editors' rights, then refused as invalid.
        if (action ? !permitted.includes(action) : permitted.length < SNAG_ACTIONS.length) throw forbidden();
        if (!action) throw validation({ action: "Action must be one of fix, close, reopen." });
        const state = snagTransition(snag.state, action);
        const saved = await one<SnagRow>(client, "UPDATE snags SET state = $2, version = version + 1 WHERE id = $1 RETURNING *", [snag.id, state]);
        return ok({ snag: saved && snagJson(saved, member, project) });
      });
    },
  },
];
