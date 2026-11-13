import { randomUUID } from "node:crypto";
import type { Notebook } from "../../shared/api";
import { imageType, readNotebookFile } from "../notebook-format";
import type { ImportedNotebook } from "../notebook-format";
import { limits } from "../config";
import { pool, queryOne } from "../db";
import { ApiError, notFound, tooLarge, validationFailed } from "../errors";
import { Problems, defineRoute, reply } from "../http";
import { encodeDocument, exportDocument, insertCell, listCells, loadNotebook, newCellId } from "../notebooks";
import { markStale, runIndexer } from "../search";
import { newId } from "../session";
import { getObject, putObject } from "../storage";
import { length, SOURCE_MAX, withoutNul } from "../validate";
import { withCommas } from "../../shared/api";

interface ImportRequest {
  bytes: Buffer;
  title: string;
  file: ImportedNotebook;
}

const importFile = defineRoute<undefined, ImportRequest>({
  method: "POST",
  path: "/api/notebooks/import",
  access: "session",
  body: "raw",
  limit: () => limits.import_max_bytes,
  tooLarge: (limit) => tooLarge(`File is larger than ${withCommas(limit)} bytes`),
  validate: (body, _resource, ctx) => {
    const bytes = body as Buffer;
    let parsed: unknown;
    try {
      parsed = JSON.parse(withoutNul(bytes.toString("utf8")));
    } catch {
      throw validationFailed([{ path: "file", message: "is not valid JSON" }]);
    }
    const { errors, notebook } = readNotebookFile(parsed);
    if (errors.length) throw validationFailed(errors);
    const title = ctx.url.searchParams.get("title") ?? "Imported notebook";
    if (title.trim() === "" || length(title) > 120) {
      const problems = new Problems();
      problems.add("title", "must be 1 to 120 characters");
      problems.done();
    }
    if (notebook.cells.some((cell) => length(cell.source) > SOURCE_MAX)) throw validationFailed([{ path: "cells", message: "have a source over 1,000,000 characters" }]);
    return { bytes, title: title.trim(), file: notebook };
  },
  run: async (ctx, _resource, request) => {
    const db = await ctx.transaction();
    const id = newId("nb");
    const cells = request.file.cells.map((cell) => ({ ...cell, id: cell.id ?? newCellId() }));
    await putObject(`notebooks/${id}/original.ipynb`, request.bytes);
    for (const cell of cells) {
      for (const attachment of cell.attachments) await putObject(`notebooks/${id}/attachments/${cell.id}/${attachment.name}`, attachment.bytes);
    }
    const counter = Math.max(0, ...cells.map((cell) => cell.execution_count ?? 0));
    await db.query("INSERT INTO notebooks (id, owner_id, title, imported, execution_counter) VALUES ($1, $2, $3, true, $4)", [id, ctx.me().id, request.title, counter]);
    for (const [position, cell] of cells.entries()) await insertCell(db, id, position, cell);
    if (cells.length === 0) await insertCell(db, id, 0, { cell_type: "code", source: "" });
    await markStale(db, id);
    ctx.afterCommit(() => void runIndexer());
    return reply(201, { notebook: (await loadNotebook(db, { id, role: "owner", owner_id: ctx.me().id })) as Notebook });
  },
});

function disposition(title: string): string {
  const name = `${title}.ipynb`;
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(name) && !/["\\]/.test(name)) return `attachment; filename="${name}"`;
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const exportNotebook = defineRoute({
  method: "GET",
  path: "/api/notebooks/:id/export",
  access: "session",
  notebook: "viewer",
  run: async (ctx) => {
    const notebook = await queryOne<{ title: string }>(pool, "SELECT title FROM notebooks WHERE id = $1", [ctx.notebook().id]);
    const bytes = encodeDocument(exportDocument(await listCells(pool, ctx.notebook().id)));
    await putObject(`notebooks/${ctx.notebook().id}/exports/${randomUUID()}.ipynb`, bytes);
    return {
      status: 200,
      bytes,
      headers: { "content-type": "application/x-ipynb+json", "content-disposition": disposition(notebook?.title ?? "notebook") },
    };
  },
});

const original = defineRoute({
  method: "GET",
  path: "/api/notebooks/:id/original",
  access: "session",
  notebook: "viewer",
  run: async (ctx) => {
    const row = await queryOne<{ imported: boolean }>(pool, "SELECT imported FROM notebooks WHERE id = $1", [ctx.notebook().id]);
    if (!row?.imported) throw new ApiError(404, "no_original", "This notebook was not imported.");
    const bytes = await getObject(`notebooks/${ctx.notebook().id}/original.ipynb`);
    if (!bytes) throw new ApiError(404, "no_original", "This notebook was not imported.");
    return { status: 200, bytes, headers: { "content-type": "application/octet-stream" } };
  },
});

const attachment = defineRoute({
  method: "GET",
  path: "/api/notebooks/:id/attachments/:cellId/:name",
  access: "session",
  notebook: "viewer",
  run: async (ctx) => {
    const bytes = await getObject(`notebooks/${ctx.notebook().id}/attachments/${ctx.params.cellId}/${ctx.params.name}`);
    if (!bytes) throw notFound();
    return { status: 200, bytes, headers: { "content-type": imageType(bytes) ?? "application/octet-stream", "x-content-type-options": "nosniff" } };
  },
});

export const fileRoutes = [importFile, exportNotebook, original, attachment];
