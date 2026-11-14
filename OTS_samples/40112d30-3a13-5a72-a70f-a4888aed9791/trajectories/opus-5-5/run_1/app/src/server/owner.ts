import { randomUUID } from "node:crypto";
import { allQuestions } from "../shared/changes.js";
import type { AnswerValue } from "../shared/types.js";
import { now, isoWithOffset, localDate } from "./clock.js";
import { config } from "./config.js";
import { one, query, tx } from "./db.js";
import { displayText, fill, walkForm } from "./engine/walk.js";
import { ApiError, notFound } from "./errors.js";
import { accessForm, editionDefinition, UUID_PATTERN } from "./forms.js";
import { buildCsv } from "./csv.js";
import { json, type Reply, type Router } from "./http.js";
import type { ResponseRow } from "./respond.js";
import { deleteObject, getObject, putObject, StorageError } from "./storage.js";
import { computeSummary, pushSummary } from "./summary.js";

function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  if (ascii === name) return `attachment; filename="${name}"`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

interface ResponseItem {
  key: string;
  label: string;
  text: string;
  value: AnswerValue | string | null;
  note?: string;
}

async function submittedResponse(formId: string, id: string): Promise<ResponseRow> {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const row = await one<ResponseRow>("SELECT * FROM responses WHERE id = $1 AND form_id = $2 AND status = 'submitted'", [id, formId]);
  if (!row) throw notFound();
  return row;
}

export function registerOwnerRoutes(router: Router): void {
  router.add("GET", "/api/forms/:id/responses", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    const rows = await query<{ id: string; submitted_at: Date; edition: number }>(
      "SELECT id, submitted_at, edition FROM responses WHERE form_id = $1 AND status = 'submitted' ORDER BY submitted_at DESC, id DESC",
      [form.id],
    );
    return json(200, {
      responses: rows.map((r) => ({ id: r.id, reference: r.id.slice(0, 8), submitted_at: isoWithOffset(r.submitted_at), edition: r.edition })),
    });
  });

  router.add("GET", "/api/forms/:id/responses/:rid", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    const response = await submittedResponse(form.id, ctx.params[1]);
    const def = await editionDefinition(form.id, response.edition);
    const walk = walkForm(def, response.answers, localDate(response.submitted_at ?? now()));
    const values = response.calc_values ?? {};
    const items = allQuestions(def).flatMap((q): ResponseItem[] => {
      const note = q.note ? { note: q.note } : {};
      if (q.type === "calculated") {
        const stored = values[q.key];
        return stored ? [{ key: q.key, label: fill(q.label, walk), text: stored.text, value: stored.value, ...note }] : [];
      }
      const value = response.answers[q.key];
      if (value === undefined) return [];
      return [{ key: q.key, label: fill(q.label, walk), text: displayText(q, walk) ?? "", value, ...note }];
    });
    const files = await query<{ id: string; question_key: string; name: string; size: number; type: string }>(
      "SELECT id, question_key, name, size, type FROM files WHERE response_id = $1 ORDER BY created_at",
      [response.id],
    );
    return json(200, {
      id: response.id,
      reference: response.id.slice(0, 8),
      edition: response.edition,
      submitted_at: isoWithOffset(response.submitted_at ?? now()),
      items,
      files: files.map((f) => ({ key: f.question_key, name: f.name, size: f.size, type: f.type, url: `/api/forms/${form.id}/files/${f.id}` })),
    });
  });

  router.add("DELETE", "/api/forms/:id/responses/:rid", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "owner");
    const response = await submittedResponse(form.id, ctx.params[1]);
    const objects = await tx(async (client) => {
      await client.query("SELECT 1 FROM forms WHERE id = $1 FOR UPDATE", [form.id]);
      const files = await query<{ object_key: string }>("SELECT object_key FROM files WHERE response_id = $1", [response.id], client);
      const deleted = await client.query("DELETE FROM responses WHERE id = $1 AND status = 'submitted'", [response.id]);
      if (deleted.rowCount) await client.query("UPDATE forms SET submitted_count = submitted_count - 1 WHERE id = $1", [form.id]);
      return files;
    });
    for (const file of objects) await deleteObject(file.object_key).catch(() => undefined);
    await pushSummary(form.id);
    return json(204);
  });

  router.add("GET", "/api/forms/:id/files/:fid", async (ctx): Promise<Reply> => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    if (!UUID_PATTERN.test(ctx.params[1])) throw notFound();
    const file = await one<{ name: string; type: string; object_key: string }>(
      `SELECT f.name, f.type, f.object_key FROM files f JOIN responses r ON r.id = f.response_id
       WHERE f.id = $1 AND f.form_id = $2 AND r.status = 'submitted'`,
      [ctx.params[1], form.id],
    );
    if (!file) throw notFound();
    let stored;
    try {
      stored = await getObject(file.object_key);
    } catch (error) {
      if (error instanceof StorageError) throw new ApiError("UPLOAD_FAILED", "The file could not be read. Try again.");
      throw error;
    }
    return { status: 200, raw: stored.body, headers: { "Content-Type": file.type, "Content-Disposition": attachment(file.name) } };
  });

  router.add("GET", "/api/forms/:id/summary", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    return json(200, await computeSummary(form.id));
  });

  router.add("POST", "/api/forms/:id/exports", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    const csv = await buildCsv(form.id, form.live_edition);
    const id = randomUUID();
    const objectKey = `exports/${form.id}/${id}.csv`;
    try {
      await putObject(objectKey, Buffer.from(csv.text, "utf8"), "text/csv; charset=utf-8");
    } catch (error) {
      if (error instanceof StorageError) throw new ApiError("EXPORT_FAILED");
      throw error;
    }
    await query("INSERT INTO exports (id, form_id, object_key, responses, created_at) VALUES ($1, $2, $3, $4, $5)", [
      id,
      form.id,
      objectKey,
      csv.count,
      now(),
    ]);
    return json(201, { id, responses: csv.count, url: `/api/forms/${form.id}/exports/${id}` });
  });

  router.add("GET", "/api/forms/:id/exports/:eid", async (ctx): Promise<Reply> => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    if (!UUID_PATTERN.test(ctx.params[1])) throw notFound();
    const row = await one<{ object_key: string; created_at: Date }>("SELECT object_key, created_at FROM exports WHERE id = $1 AND form_id = $2", [
      ctx.params[1],
      form.id,
    ]);
    if (!row || now().getTime() > row.created_at.getTime() + config.exportLinkTtlMinutes * 60_000) throw notFound();
    let stored;
    try {
      stored = await getObject(row.object_key);
    } catch (error) {
      if (error instanceof StorageError) throw new ApiError("EXPORT_FAILED");
      throw error;
    }
    return {
      status: 200,
      raw: stored.body,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${form.slug}-responses.csv"` },
    };
  });
}
