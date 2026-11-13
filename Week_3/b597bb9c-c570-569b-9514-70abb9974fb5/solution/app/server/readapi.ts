import { loadProjectRow } from "./timeline/store";
import { decodeCursor, encodeCursor, pageLimit } from "./cursor";
import { listProjects } from "./projects";
import { one, pool, query } from "./db";
import { notFound } from "./errors";
import { commentFromRow, pinClips } from "./comments";
import { loadTimeline } from "./timeline/store";
import type { Actor } from "./access";

interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** A page strictly after the cursor position, ordered by `seq`; `rows` must already be in seq order. */
function pageOf<T extends { seq: number }, R>(rows: readonly T[], params: URLSearchParams, shape: (row: T) => R): Page<R> {
  const limit = pageLimit(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));
  const after = cursor ? Number(cursor.sortValue) : -Infinity;
  const later = rows.filter((row) => row.seq > after);
  const items = later.slice(0, limit);
  const last = items[items.length - 1];
  return { items: items.map(shape), next_cursor: later.length > limit && last ? encodeCursor(last.seq, "") : null };
}

const workspaceOwner = async (): Promise<Actor> => {
  const row = await one<Actor>("SELECT id, name, email, handle, is_owner FROM people WHERE is_owner LIMIT 1");
  if (!row) throw notFound();
  return row;
};

const projectShape = (project: { id: string; title: string; agency: string; frame_rate: string; aspect_ratio: string; total_frames: number }, updatedAt: Date) => ({
  id: project.id,
  title: project.title,
  agency: project.agency,
  frame_rate: project.frame_rate,
  aspect_ratio: project.aspect_ratio,
  total_frames: project.total_frames,
  updated_at: updatedAt.toISOString(),
});

async function updatedAtOf(id: string): Promise<Date> {
  const row = await loadProjectRow(pool, id);
  if (!row) throw notFound();
  return row.updated_at;
}

export async function readProjects(params: URLSearchParams): Promise<Page<ReturnType<typeof projectShape>>> {
  const projects = await listProjects(await workspaceOwner());
  const rows = await Promise.all(
    projects.map(async (project, index) => ({ seq: index + 1, project, updated: await updatedAtOf(project.id) })),
  );
  return pageOf(rows, params, (row) => projectShape(row.project, row.updated));
}

export async function readProject(id: string): Promise<ReturnType<typeof projectShape>> {
  const project = (await listProjects(await workspaceOwner())).find((candidate) => candidate.id === id);
  if (!project) throw notFound();
  return projectShape(project, await updatedAtOf(id));
}

async function requireProject(id: string) {
  const row = await loadProjectRow(pool, id);
  if (!row) throw notFound();
  return row;
}

export async function readClips(id: string, params: URLSearchParams) {
  const project = await requireProject(id);
  const timeline = await loadTimeline(pool, project);
  const seqs = new Map((await query<{ id: string; seq: number }>("SELECT id, seq FROM clips WHERE project_id = $1", [id])).map((row) => [row.id, row.seq]));
  const rows = timeline.clips.map((clip) => ({ clip, seq: seqs.get(clip.id) ?? 0 })).sort((a, b) => a.seq - b.seq);
  return pageOf(rows, params, ({ clip }) => ({
    id: clip.id,
    row_id: clip.row_id,
    name: clip.name,
    kind: clip.kind,
    start_frame: clip.start_frame,
    end_frame: clip.end_frame,
    hidden: clip.hidden,
  }));
}

export async function readCuts(id: string, params: URLSearchParams) {
  await requireProject(id);
  const rows = await query<{ id: string; name: string; total_frames: number; created_at: Date; seq: number }>(
    "SELECT id, name, total_frames, created_at, seq FROM cuts WHERE project_id = $1 AND shared ORDER BY seq",
    [id],
  );
  return pageOf(rows, params, (cut) => ({ id: cut.id, name: cut.name, total_frames: cut.total_frames, created_at: cut.created_at.toISOString() }));
}

export async function readExports(id: string, params: URLSearchParams) {
  await requireProject(id);
  const rows = await query<{ id: string; cut_id: string; size: number; state: string; minutes: number; finished_at: Date | null; seq: number }>(
    "SELECT id, cut_id, size, state, minutes, finished_at, seq FROM exports WHERE project_id = $1 ORDER BY seq",
    [id],
  );
  return pageOf(rows, params, (row) => ({
    id: row.id,
    cut_id: row.cut_id,
    size: row.size,
    state: row.state,
    minutes: row.minutes,
    finished_at: row.finished_at ? row.finished_at.toISOString() : null,
  }));
}

export async function readComments(id: string, params: URLSearchParams) {
  await requireProject(id);
  const rows = await query<Parameters<typeof commentFromRow>[0] & { seq: number }>(
    "SELECT * FROM comments WHERE project_id = $1 AND visibility = 'review' ORDER BY seq",
    [id],
  );
  const clips = await pinClips(pool, id);
  return pageOf(rows, params, (row) => {
    const comment = commentFromRow(row, clips);
    return {
      id: comment.id,
      cut_id: comment.cut_id,
      frame: comment.pin.frame,
      body: comment.body,
      author_name: comment.author_name,
      created_at: comment.created_at,
    };
  });
}
