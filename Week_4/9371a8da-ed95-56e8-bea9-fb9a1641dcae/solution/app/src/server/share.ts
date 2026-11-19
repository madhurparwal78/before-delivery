// Read-only share links: one project's files, figures, review and citations, people by display name only.
import type { Review, SharedPerson } from "../shared/api.ts";
import { sharedPerson } from "./access.ts";
import { citationReport } from "./citations.ts";
import { one, pool } from "./db.ts";
import { rawBytes } from "./files.ts";
import { fail, ok, type Context, type Reply } from "./http.ts";
import { currentFile, fileShape, textFileShape, treeAt } from "./projects.ts";
import { reviewOf } from "./review.ts";

interface SharedProject {
  id: string;
  title: string;
  revision: number;
}

/** A live token's project; unknown, replaced, revoked or expired tokens are dead (judged by the server clock in UTC). */
export async function sharedProject(token: string): Promise<SharedProject | null> {
  const row = await one<SharedProject & { expires_at: Date }>(
    pool,
    `SELECT p.id, p.title, p.revision, s.expires_at FROM share_links s JOIN projects p ON p.id = s.project_id WHERE s.token = $1`,
    [token],
  );
  if (!row || Date.now() >= row.expires_at.getTime()) return null;
  return { id: row.id, title: row.title, revision: row.revision };
}

async function liveProject(ctx: Context): Promise<SharedProject> {
  const project = await sharedProject(ctx.params.token ?? "");
  if (!project) throw fail.notFound();
  return project;
}

export async function readShared(ctx: Context): Promise<Reply> {
  const project = await liveProject(ctx);
  const files = await treeAt(pool, project.id, project.revision);
  return ok({ project: { title: project.title, projectRevision: project.revision }, files: files.map((file) => fileShape(file)) });
}

export async function readSharedFile(ctx: Context): Promise<Reply> {
  const project = await liveProject(ctx);
  const file = await currentFile(pool, project.id, project.revision, ctx.params.fid ?? "");
  return ok({ file: file.kind === "text" ? await textFileShape(pool, file) : fileShape(file) });
}

export async function readSharedRaw(ctx: Context): Promise<Reply> {
  const project = await liveProject(ctx);
  return rawBytes(project.id, await currentFile(pool, project.id, project.revision, ctx.params.fid ?? ""));
}

export async function readSharedReview(ctx: Context): Promise<Reply> {
  const project = await liveProject(ctx);
  const review = await reviewOf(pool, project.id);
  const narrowed: Review<SharedPerson> = {
    suggestions: review.suggestions.map((item) => ({
      ...item,
      author: sharedPerson(item.author),
      resolvedBy: item.resolvedBy ? sharedPerson(item.resolvedBy) : null,
    })),
    threads: review.threads.map((item) => ({
      ...item,
      comments: item.comments.map((comment) => ({ ...comment, author: sharedPerson(comment.author) })),
      resolvedBy: item.resolvedBy ? sharedPerson(item.resolvedBy) : null,
    })),
    openSuggestions: review.openSuggestions,
  };
  return ok(narrowed);
}

export async function readSharedCitations(ctx: Context): Promise<Reply> {
  const project = await liveProject(ctx);
  return ok(await citationReport(pool, project.id, project.revision));
}
