// Wiki pages: every save is the next version, saving on a stale base is refused, and the HTML comes from the Markdown subset.
import type { Queryable, Tx } from "../db.ts";
import { db, withTx } from "../db.ts";
import { projectScope, requireAction, type ProjectRow } from "../access.ts";
import { iso, now } from "../clock.ts";
import { conflict, FieldErrors, notFound } from "../errors.ts";
import { intParam, json, type Ctx, type Router } from "../http.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { branchHead, readFile } from "../repo/index.ts";
import { bodyOf, titleProblem } from "./util.ts";

interface VersionRow {
  readonly slug: string;
  readonly version: number;
  readonly title: string;
  readonly content: string;
  readonly author: string;
  readonly created_at: number;
}

const SLUG = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u;

const assetUrl = (projectId: number) => (path: string): string => `/api/projects/${projectId}/wiki-assets/${path.split("/").map(encodeURIComponent).join("/")}`;

function html(project: ProjectRow, content: string): string {
  return renderMarkdown(content, { imageBase: assetUrl(project.id) });
}

function pageBody(project: ProjectRow, row: VersionRow): Record<string, unknown> {
  return { slug: row.slug, version: row.version, title: row.title, content: row.content, html: html(project, row.content), author: row.author, updated_at: iso(row.created_at) };
}

async function latest(q: Queryable, projectId: number, slug: string): Promise<VersionRow | undefined> {
  return q.maybe<VersionRow>(
    "SELECT slug, version, title, content, author, created_at FROM wiki_versions WHERE project_id = $1 AND slug = $2 ORDER BY version DESC LIMIT 1",
    [projectId, slug],
  );
}

type Target = { readonly slug: string; readonly tail: "versions" | "restore" | null };

function targetOf(ctx: Ctx): Target {
  const raw = ctx.params["slug"] ?? "";
  if (ctx.method === "GET" && raw.endsWith("/versions")) return { slug: raw.slice(0, -"/versions".length), tail: "versions" };
  if (ctx.method === "POST" && raw.endsWith("/restore")) return { slug: raw.slice(0, -"/restore".length), tail: "restore" };
  return { slug: raw, tail: null };
}

async function saveVersion(tx: Tx, project: ProjectRow, slug: string, next: { version: number; title: string; content: string; author: string }): Promise<VersionRow> {
  const row = await tx.one<VersionRow>(
    `INSERT INTO wiki_versions (project_id, slug, version, title, content, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING slug, version, title, content, author, created_at`,
    [project.id, slug, next.version, next.title, next.content, next.author, now()],
  );
  return row;
}

async function putPage(tx: Tx, ctx: Ctx, project: ProjectRow, slug: string): Promise<Record<string, unknown>> {
  await tx.lockProject(project.id);
  const body = bodyOf(ctx);
  const errors = new FieldErrors();
  if (!SLUG.test(slug)) errors.add("slug", "Slug can only use a-z, 0-9, - and /.");
  const problem = titleProblem(body["title"]);
  if (problem !== null) errors.add("title", problem);
  if (typeof body["content"] !== "string") errors.add("content", "Content must be text.");
  const base = body["base_version"];
  const baseValid = typeof base === "number" && Number.isInteger(base) && base >= 0;
  if (!baseValid) errors.add("base_version", "Base version must be a whole number.");
  const current = SLUG.test(slug) ? await latest(tx, project.id, slug) : undefined;
  if (current !== undefined && baseValid && base < current.version) {
    throw conflict("stale_wiki", `${current.author} edited this page. Your base version ${base} is behind ${current.version}.`);
  }
  if (baseValid && base !== (current?.version ?? 0)) errors.add("base_version", "Base version is ahead of the page.");
  errors.throwIfAny();
  const saved = await saveVersion(tx, project, slug, {
    version: (current?.version ?? 0) + 1, title: String(body["title"]).trim(), content: String(body["content"]), author: ctx.user.username,
  });
  const seq = await tx.emit(project.id, "wiki", { slug });
  return { ...pageBody(project, saved), seq };
}

async function restorePage(tx: Tx, ctx: Ctx, project: ProjectRow, slug: string): Promise<Record<string, unknown>> {
  await tx.lockProject(project.id);
  const wanted = bodyOf(ctx)["version"];
  const old = typeof wanted === "number" && Number.isInteger(wanted)
    ? await tx.maybe<VersionRow>(
        "SELECT slug, version, title, content, author, created_at FROM wiki_versions WHERE project_id = $1 AND slug = $2 AND version = $3",
        [project.id, slug, wanted],
      )
    : undefined;
  const current = await latest(tx, project.id, slug);
  if (old === undefined || current === undefined) throw notFound();
  const saved = await saveVersion(tx, project, slug, { version: current.version + 1, title: old.title, content: old.content, author: ctx.user.username });
  const seq = await tx.emit(project.id, "wiki", { slug });
  return { ...pageBody(project, saved), seq };
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function registerWikiRoutes(router: Router): void {
  router.get("/api/projects/:id/wiki", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "wiki.read");
    const rows = await db.q<VersionRow>(
      `SELECT DISTINCT ON (slug) slug, version, title, content, author, created_at FROM wiki_versions WHERE project_id = $1 ORDER BY slug, version DESC`,
      [project.id],
    );
    return json(200, { pages: rows.map((row) => ({ slug: row.slug, title: row.title, version: row.version, author: row.author, updated_at: iso(row.created_at) })) });
  });

  router.get("/api/projects/:id/wiki/*slug", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "wiki.read");
    const target = targetOf(ctx);
    if (!SLUG.test(target.slug)) throw notFound();
    if (target.tail === "versions") {
      const rows = await db.q<VersionRow>(
        "SELECT slug, version, title, content, author, created_at FROM wiki_versions WHERE project_id = $1 AND slug = $2 ORDER BY version",
        [project.id, target.slug],
      );
      if (rows.length === 0) throw notFound();
      return json(200, { versions: rows.map((row) => ({ version: row.version, title: row.title, content: row.content, author: row.author, created_at: iso(row.created_at) })) });
    }
    const row = await latest(db, project.id, target.slug);
    if (row === undefined) throw notFound();
    return json(200, pageBody(project, row));
  });

  router.put("/api/projects/:id/wiki/*slug", async (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "wiki.write");
      return json(200, await putPage(tx, ctx, project, targetOf(ctx).slug));
    }),
  );

  router.post("/api/projects/:id/wiki/*slug", async (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      const target = targetOf(ctx);
      if (target.tail !== "restore" || !SLUG.test(target.slug)) throw notFound();
      requireAction(access, "wiki.write");
      return json(201, await restorePage(tx, ctx, project, target.slug));
    }),
  );

  router.get("/api/projects/:id/wiki-assets/*path", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "code.read");
    const path = ctx.params["path"] ?? "";
    const type = IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
    const head = await branchHead(db, project.id, project.default_branch);
    const content = type === undefined || head === null ? null : await readFile(db, project.id, head, path);
    if (type === undefined || content === null) throw notFound();
    return {
      status: 200,
      raw: content,
      contentType: type,
      headers: { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "x-content-type-options": "nosniff" },
    };
  });
}
