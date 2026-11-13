import type { ImportRecord } from "../../shared/api.js";
import { one, pool, rows } from "../db.js";
import { IMPORT_LIMIT, parseDeedlist, readText } from "../domain/importer.js";
import { insertTask } from "../domain/ordering.js";
import { loadUser } from "../domain/progress.js";
import { HttpError, Refusal } from "../errors.js";
import { isUuid, reply, route } from "../http.js";
import { mutate } from "../mutate.js";
import { getObject, putObject } from "../storage.js";
import { importView } from "../views.js";

type ImportRow = Parameters<typeof importView>[0];

const importKey = (userId: string, importId: string): string => `imports/${userId}/${importId}.deedlist`;

route(
  "POST",
  "/api/imports",
  async (context) => {
    const account = await context.user();
    const file = context.multipartFile(IMPORT_LIMIT);
    const text = file.filename.endsWith(".deedlist") ? readText(file.bytes) : undefined;
    if (text === undefined) throw Refusal.unsupportedFileType();
    const importId = crypto.randomUUID();
    await putObject(importKey(account.id, importId), file.bytes, "text/plain; charset=utf-8");
    const parsed = parseDeedlist(text);
    const record = await mutate(async (db, touch) => {
      const user = await loadUser(db, account.id);
      const lines: ImportRecord["lines"] = [];
      for (const task of parsed.errors.length > 0 ? [] : parsed.tasks) {
        const created = await insertTask(db, user.id, task);
        for (const [index, item] of task.checklist.entries()) {
          await db.query("INSERT INTO checklist_items (task_id, text, position) VALUES ($1, $2, $3)", [created.id, item, index + 1]);
        }
        lines.push({ line: task.line, taskId: created.id, type: task.type, title: task.title });
      }
      if (lines.length > 0) touch.taskList(user.id);
      return (await one<ImportRow>(
        db,
        `INSERT INTO imports (id, user_id, filename, size, status, task_count, error_count, lines, errors)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          importId,
          user.id,
          file.filename,
          file.bytes.length,
          parsed.errors.length > 0 ? "rejected" : "imported",
          lines.length,
          parsed.errors.length,
          JSON.stringify(lines),
          JSON.stringify(parsed.errors),
        ],
      ))!;
    });
    if (record.status === "rejected") throw new HttpError(422, { importId: record.id, errors: parsed.errors });
    return reply(201, importView(record));
  },
  IMPORT_LIMIT + 8192,
);

route("GET", "/api/imports", async (context) => {
  const user = await context.user();
  const records = await rows<ImportRow>(pool, "SELECT * FROM imports WHERE user_id = $1 ORDER BY seq DESC", [user.id]);
  return reply(200, { imports: records.map(importView) });
});

async function ownImport(userId: string, id: string): Promise<ImportRow> {
  const record = isUuid(id) ? await one<ImportRow>(pool, "SELECT * FROM imports WHERE id = $1 AND user_id = $2", [id, userId]) : undefined;
  if (!record) throw Refusal.notFound();
  return record;
}

route("GET", "/api/imports/:id", async (context) => {
  const user = await context.user();
  return reply(200, importView(await ownImport(user.id, context.params.id!)));
});

route("GET", "/api/imports/:id/original", async (context) => {
  const user = await context.user();
  const record = await ownImport(user.id, context.params.id!);
  const bytes = await getObject(importKey(user.id, record.id));
  const disposition = `attachment; filename="${record.filename.replaceAll('"', "%22")}"`;
  return {
    status: 200,
    raw: bytes,
    contentType: "text/plain; charset=utf-8",
    headers: { "Content-Disposition": Buffer.from(disposition, "utf8").toString("latin1") },
  };
});
