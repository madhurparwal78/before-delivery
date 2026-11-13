import type { Notebook, NotebookListItem } from "../../shared/api";
import { pool, query } from "../db";
import { notFound } from "../errors";
import { Problems, defineRoute, reply } from "../http";
import { insertCell, loadNotebook } from "../notebooks";
import { closeNotebook } from "../live";
import { markStale, runIndexer } from "../search";
import { newId } from "../session";
import { deleteObject, listObjects } from "../storage";
import { field, length } from "../validate";

const validTitle = (title: unknown): title is string => typeof title === "string" && title.trim() !== "" && length(title) <= 120;

const listNotebooks = defineRoute({
  method: "GET",
  path: "/api/notebooks",
  access: "session",
  run: async (ctx) => {
    const notebooks = await query<NotebookListItem>(
      pool,
      `SELECT n.id, n.title, CASE WHEN n.owner_id = $1 THEN 'owner' ELSE s.role END AS role,
              o.display_name AS owner_display_name, n.modified_at
         FROM notebooks n JOIN users o ON o.id = n.owner_id
         LEFT JOIN shares s ON s.notebook_id = n.id AND s.user_id = $1 AND s.status = 'active'
        WHERE n.owner_id = $1 OR s.id IS NOT NULL
        ORDER BY n.modified_at DESC, n.id`,
      [ctx.me().id],
    );
    return reply(200, { notebooks });
  },
});

const createNotebook = defineRoute<undefined, string>({
  method: "POST",
  path: "/api/notebooks",
  access: "session",
  body: "json",
  validate: (body) => {
    const title = field(body, "title");
    if (!validTitle(title)) {
      const problems = new Problems();
      problems.add("title", "must be 1 to 120 characters");
      problems.done();
    }
    return (title as string).trim();
  },
  run: async (ctx, _resource, title) => {
    const db = await ctx.transaction();
    const id = newId("nb");
    await db.query("INSERT INTO notebooks (id, owner_id, title) VALUES ($1, $2, $3)", [id, ctx.me().id, title]);
    await insertCell(db, id, 0, { cell_type: "code", source: "" });
    await markStale(db, id);
    ctx.afterCommit(() => void runIndexer());
    const notebook = await loadNotebook(db, { id, role: "owner", owner_id: ctx.me().id });
    return reply(201, { notebook: notebook as Notebook });
  },
});

const getNotebook = defineRoute({
  method: "GET",
  path: "/api/notebooks/:id",
  access: "session",
  notebook: "viewer",
  run: async (ctx) => {
    const notebook = await loadNotebook(pool, ctx.notebook());
    if (!notebook) throw notFound();
    return reply(200, { notebook });
  },
});

const deleteNotebook = defineRoute({
  method: "DELETE",
  path: "/api/notebooks/:id",
  access: "session",
  notebook: "owner",
  write: true,
  run: async (ctx) => {
    const db = await ctx.transaction();
    const id = ctx.notebook().id;
    for (const key of await listObjects(`notebooks/${id}/`)) await deleteObject(key);
    await db.query("DELETE FROM notebooks WHERE id = $1", [id]);
    await markStale(db, id);
    ctx.afterCommit(() => {
      closeNotebook(id);
      void runIndexer();
    });
    return reply(204);
  },
});

export const notebookRoutes = [listNotebooks, createNotebook, getNotebook, deleteNotebook];
