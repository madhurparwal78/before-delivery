import { randomUUID } from "node:crypto";
import { copy } from "../../shared/copy";
import { PROJECT_BODY_LIMIT } from "../../shared/limits";
import { isFrozen, isValidName } from "../../shared/rules";
import type { Project, ProjectKind } from "../../shared/types";
import { requirePrincipal } from "../auth";
import { classroomState } from "../classroom-state";
import { serverNow } from "../clock";
import { findClassroom } from "../classrooms-store";
import { sha256Hex } from "../digest";
import { first, pool, rows, withTransaction, type Queryable } from "../db";
import { ApiError, assertNoFieldErrors, validationError } from "../errors";
import type { Request, Route } from "../http-types";
import { classroomStateOf, openProject, PROJECT_COLUMNS, projectAudience, projectView, snapshotKey, viewProject, type ProjectRecord } from "../projects-store";
import { getObject, putObject, whenStorageUp } from "../s3";
import { publish } from "../stream-hub";

const KINDS: readonly ProjectKind[] = ["3d", "circuit", "blocks"];
const DEFAULT_NAMES: Record<ProjectKind, string> = {
  "3d": "Untitled 3D design", circuit: "Untitled circuit", blocks: "Untitled block program",
};
const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;

const isKind = (value: unknown): value is ProjectKind => KINDS.includes(value as ProjectKind);

/** A snapshot is a JSON object whose `kind` is the project's kind. */
function checkSnapshot(kind: ProjectKind, snapshot: unknown, fields: Record<string, string>): void {
  const isObject = typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot);
  if (!isObject || (snapshot as { kind?: unknown }).kind !== kind) fields.snapshot = copy.validation;
}

function checkName(name: unknown, fields: Record<string, string>): string | undefined {
  if (typeof name === "string" && isValidName(name)) return name.trim();
  fields.name = copy.nameInvalid;
  return undefined;
}

async function publishSaved(project: ProjectRecord): Promise<void> {
  publish(await projectAudience(project), "project-saved", {
    projectId: project.id, ownerId: project.ownerId, classroomId: project.classroomId, revision: project.revision,
    savedAt: project.savedAt.toISOString(), kind: project.kind, name: project.name,
  });
}

const list: Route = {
  method: "GET",
  pattern: "/api/projects",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const owned = await rows<ProjectRecord>(pool,
      `SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.owner_id = $1 ORDER BY p.saved_at DESC, p.id`, [account.id]);
    const classroom = await classroomStateOf(account.classroomId);
    return { status: 200, body: { projects: owned.map((project) => projectView(project, classroom)) } };
  },
};

const create: Route = {
  method: "POST",
  pattern: "/api/projects",
  bodyLimit: PROJECT_BODY_LIMIT,
  async handler(req) {
    const { account } = await requirePrincipal(req);
    if (!account.emailVerified) throw new ApiError("email_unverified", { message: copy.unverifiedSave });
    const classroom = account.classroomId ? await findClassroom(account.classroomId) : null;
    const now = serverNow();
    if (classroom && isFrozen(classroomState(classroom, now))) throw new ApiError("classroom_handed_in");

    const body = req.jsonObject();
    const fields: Record<string, string> = {};
    const kind = isKind(body.kind) ? body.kind : undefined;
    if (!kind) fields.kind = copy.validation;
    const name = body.name === undefined && kind ? DEFAULT_NAMES[kind] : checkName(body.name, fields);
    if (kind) checkSnapshot(kind, body.snapshot, fields);
    assertNoFieldErrors(fields);
    if (!kind || name === undefined) throw validationError(fields);

    const id = randomUUID();
    const key = snapshotKey(id, 1);
    await whenStorageUp(copy.saveStorage, () => putObject(key, Buffer.from(JSON.stringify(body.snapshot)), "application/json"));
    const project: ProjectRecord = {
      id, ownerId: account.id, classroomId: account.classroomId, kind, name, revision: 1,
      savedAt: now, handedInAt: null,
    };
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO projects (id, owner_id, classroom_id, kind, name, revision, saved_at) VALUES ($1, $2, $3, $4, $5, 1, $6)`,
        [id, account.id, account.classroomId, project.kind, project.name, now]);
      await client.query("INSERT INTO revisions (project_id, revision, object_key, saved_at) VALUES ($1, 1, $2, $3)", [id, key, now]);
    });
    await publishSaved(project);
    return { status: 201, body: { project: projectView(project, classroom && classroomState(classroom, now)) } };
  },
};

const open: Route = {
  method: "GET",
  pattern: "/api/projects/:id",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const project = await openProject(account, req.param("id"));
    const stored = await whenStorageUp(copy.openStorage, () => getObject(snapshotKey(project.id, project.revision)));
    return { status: 200, body: { project: await viewProject(project), snapshot: JSON.parse(stored.toString("utf8")) as unknown } };
  },
};

interface Replay {
  bodyHash: string;
  response: { project: Project };
}

/** The remembered answer to this key, if it is under 24 hours old; the same key with another body is a conflict. */
async function replayOf(client: Queryable, projectId: string, accountId: string, req: Request) {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string") return null;
  const remembered = await first<Replay>(client,
    `SELECT body_hash AS "bodyHash", response FROM idempotency_keys
     WHERE project_id = $1 AND account_id = $2 AND key = $3 AND created_at > $4`,
    [projectId, accountId, key, new Date(serverNow().getTime() - IDEMPOTENCY_TTL_MS)]);
  if (!remembered) return null;
  if (remembered.bodyHash !== sha256Hex(req.body)) throw new ApiError("idempotency_conflict");
  return remembered.response;
}

const save: Route = {
  method: "PUT",
  pattern: "/api/projects/:id",
  bodyLimit: PROJECT_BODY_LIMIT,
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const saved = await withTransaction(async (client) => {
      const project = await openProject(account, req.param("id"), client, true);
      const replay = await replayOf(client, project.id, account.id, req);
      if (replay) return { response: replay, fresh: null };
      if (project.ownerId !== account.id) throw new ApiError("forbidden");
      if (!account.emailVerified) throw new ApiError("email_unverified", { message: copy.unverifiedSave });

      const now = serverNow();
      const classroom = await classroomStateOf(project.classroomId, client);
      if (classroom && isFrozen(classroom)) throw new ApiError("classroom_handed_in");
      if (project.handedInAt) throw new ApiError("project_handed_in");
      const body = req.jsonObject();
      if (Number.isInteger(body.baseRevision) && body.baseRevision !== project.revision) {
        throw new ApiError("stale_revision", { currentRevision: project.revision });
      }

      const fields: Record<string, string> = {};
      if (!Number.isInteger(body.baseRevision)) fields.baseRevision = copy.validation;
      const name = body.name === undefined ? project.name : checkName(body.name, fields);
      checkSnapshot(project.kind, body.snapshot, fields);
      assertNoFieldErrors(fields);
      if (name === undefined) throw validationError(fields);

      const revision = project.revision + 1;
      const key = snapshotKey(project.id, revision);
      await whenStorageUp(copy.saveStorage, () => putObject(key, Buffer.from(JSON.stringify(body.snapshot)), "application/json"));
      const next: ProjectRecord = { ...project, name, revision, savedAt: now };
      await client.query("INSERT INTO revisions (project_id, revision, object_key, saved_at) VALUES ($1, $2, $3, $4)", [project.id, revision, key, now]);
      await client.query("UPDATE projects SET name = $2, revision = $3, saved_at = $4 WHERE id = $1", [project.id, next.name, revision, now]);
      const response = { project: projectView(next, classroom) };
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey === "string") {
        await client.query(
          `INSERT INTO idempotency_keys (project_id, account_id, key, body_hash, response, created_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project_id, account_id, key) DO UPDATE SET body_hash = $4, response = $5, created_at = $6`,
          [project.id, account.id, idempotencyKey, sha256Hex(req.body), response, now]);
      }
      return { response, fresh: next };
    });
    if (saved.fresh) await publishSaved(saved.fresh);
    return { status: 200, body: saved.response };
  },
};

const handIn: Route = {
  method: "POST",
  pattern: "/api/projects/:id/hand-in",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const result = await withTransaction(async (client) => {
      const project = await openProject(account, req.param("id"), client, true);
      if (project.ownerId !== account.id) throw new ApiError("forbidden");
      const { classroomId } = project;
      if (classroomId === null) throw new ApiError("not_a_classroom_project");
      const classroom = await classroomStateOf(classroomId, client);
      if (classroom && isFrozen(classroom)) throw new ApiError("classroom_handed_in");
      if (project.handedInAt) throw new ApiError("project_handed_in");
      const handedInAt = serverNow();
      await client.query("UPDATE projects SET handed_in_at = $2 WHERE id = $1", [project.id, handedInAt]);
      return { project: { ...project, handedInAt }, classroomId, classroom };
    });
    publish(await projectAudience(result.project), "project-handed-in",
      { projectId: result.project.id, ownerId: result.project.ownerId, classroomId: result.classroomId });
    return { status: 200, body: { project: projectView(result.project, result.classroom) } };
  },
};

export const projectRoutes: Route[] = [list, create, open, save, handIn];
