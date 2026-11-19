import { copy } from "../shared/copy";
import type { Account, ClassroomState, Project, ProjectKind } from "../shared/types";
import { classroomState, projectState } from "./classroom-state";
import { serverNow } from "./clock";
import { educatorAudience, findClassroom, isEducatorOf } from "./classrooms-store";
import { first, pool, type Queryable } from "./db";
import { ApiError } from "./errors";

export interface ProjectRecord {
  id: string;
  ownerId: string;
  classroomId: string | null;
  kind: ProjectKind;
  name: string;
  revision: number;
  savedAt: Date;
  handedInAt: Date | null;
}

export const PROJECT_COLUMNS = `p.id, p.owner_id AS "ownerId", p.classroom_id AS "classroomId", p.kind, p.name, p.revision,
  p.saved_at AS "savedAt", p.handed_in_at AS "handedInAt"`;

export function projectNotFound(): ApiError {
  return new ApiError("not_found", { message: copy.projectNotFound });
}

/** A project the account may see: its own, or a Student's in a classroom the account teaches. Anything else is not found. */
export async function openProject(account: Account, id: string, db: Queryable = pool, lock = false): Promise<ProjectRecord> {
  const project = await first<ProjectRecord>(db,
    `SELECT ${PROJECT_COLUMNS} FROM projects p
     WHERE p.id = $1 AND (p.owner_id = $2 OR (p.classroom_id IS NOT NULL AND ${isEducatorOf("p.classroom_id", "$2")}))
     ${lock ? "FOR UPDATE OF p" : ""}`, [id, account.id]);
  if (!project) throw projectNotFound();
  return project;
}

export async function classroomStateOf(classroomId: string | null, db: Queryable = pool): Promise<ClassroomState | null> {
  const classroom = classroomId ? await findClassroom(classroomId, db) : null;
  return classroom ? classroomState(classroom, serverNow()) : null;
}

export function projectView(project: ProjectRecord, classroom: ClassroomState | null): Project {
  return {
    id: project.id, kind: project.kind, name: project.name, ownerId: project.ownerId, classroomId: project.classroomId,
    revision: project.revision, savedAt: project.savedAt.toISOString(), state: projectState(project.handedInAt, classroom),
  };
}

export async function viewProject(project: ProjectRecord, db: Queryable = pool): Promise<Project> {
  return projectView(project, await classroomStateOf(project.classroomId, db));
}

/** Who is told about a project: its owner and, for a Student's project, the classroom's educators with a stream open. */
export async function projectAudience(project: Pick<ProjectRecord, "ownerId" | "classroomId">): Promise<string[]> {
  return [project.ownerId, ...(project.classroomId ? await educatorAudience(project.classroomId) : [])];
}

export const snapshotKey = (projectId: string, revision: number): string => `projects/${projectId}/rev-${revision}.json`;
