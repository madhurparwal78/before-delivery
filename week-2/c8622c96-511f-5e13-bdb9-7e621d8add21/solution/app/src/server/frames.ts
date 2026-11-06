// Frame uploads, caption edits and deletes. An upload is accepted by its content and size only.
import { query, one, transaction, type Client } from "./db.js";
import { creditedEssay, bumpVersion, etagOf } from "./essays.js";
import { FRAME_CAPTION } from "./essay-fields.js";
import type { EssayRow, FrameRow } from "./essay-model.js";
import { ApiError, notFound, parseMultipart, sendJson, sendNoContent, UPLOAD_LIMIT, validationFailed } from "./http.js";
import { deriveFrame, sniff } from "./images.js";
import { assertTransition } from "./lifecycle.js";
import { on, type Ctx } from "./router.js";
import { deleteObject, keys, putObject, VARIANTS } from "./s3.js";
import { strictBody } from "./strict-body.js";

const MAX_FRAMES = 24;
const UNREADABLE = "This file can't be read as an image";

const frameBody = (frame: FrameRow, version: number): Record<string, unknown> => ({
  id: frame.id, position: frame.position, caption: frame.caption, filename: frame.filename, bytes: frame.bytes,
  type: frame.type, width: frame.width, height: frame.height, essay_version: version,
});

/** Runs `work` on an essay the caller may edit right now: credited, and still a draft. */
async function editableDraft<T>(ctx: Ctx, essayId: string, work: (essay: EssayRow, client: Client) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, essayId, client);
    assertTransition(essay.state, "edit");
    return work(essay, client);
  });
}

/** The essay's frame count, refusing the upload when it already holds the maximum. */
async function frameCountBelowLimit(essayId: string, client?: Client): Promise<number> {
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM frames WHERE essay_id = $1", [essayId], client);
  const n = count?.n ?? 0;
  if (n >= MAX_FRAMES) throw validationFailed({ file: `An essay holds at most ${MAX_FRAMES} frames` });
  return n;
}

on("POST", "/api/essays/:id/frames", "multipart", async (ctx: Ctx) => {
  const essayId = ctx.params[0] ?? "";
  await editableDraft(ctx, essayId, async () => undefined);
  if (ctx.multipart.overLimit) throw new ApiError(413, "file_too_large", "Each frame may be at most 25,000,000 bytes.");
  const parts = parseMultipart(ctx.multipart.bytes, ctx.req.headers["content-type"] ?? "");
  const file = parts?.find((p) => p.name === "file" && p.filename !== null);
  if (!file) throw validationFailed({ file: UNREADABLE });
  if (file.data.length > UPLOAD_LIMIT) throw new ApiError(413, "file_too_large", "Each frame may be at most 25,000,000 bytes.");
  const type = sniff(file.data);
  if (!type) throw new ApiError(415, "unsupported_type", "Upload a JPEG or PNG image.");
  const caption = parts?.find((p) => p.name === "caption" && p.filename === null)?.data.toString("utf8") ?? "";
  if ([...caption].length > 500) throw validationFailed({ caption: FRAME_CAPTION });
  await frameCountBelowLimit(essayId);
  const derivatives = await deriveFrame(file.data, type);
  if (!derivatives) throw validationFailed({ file: UNREADABLE });
  const seq = await one<{ frame_seq: number }>(
    "UPDATE essays SET frame_seq = frame_seq + 1 WHERE id = $1 RETURNING frame_seq", [essayId]);
  const frameId = `${essayId}-f${seq?.frame_seq ?? 0}`;
  await putObject(keys.original(essayId, frameId), file.data, type);
  for (const variant of VARIANTS) {
    await putObject(keys.derivative(essayId, frameId, variant), Buffer.from(derivatives[variant]), "image/jpeg");
  }
  const filename = (file.filename ?? "").split(/[\\/]/).pop() ?? "";
  const result = await editableDraft(ctx, essayId, async (essay, client) => {
    const taken = await frameCountBelowLimit(essay.id, client);
    const [frame] = await query<FrameRow>(
      `INSERT INTO frames (id, essay_id, position, caption, filename, bytes, type, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [frameId, essay.id, taken + 1, caption, filename, file.data.length, type, derivatives.width,
        derivatives.height], client);
    return { frame: frame as FrameRow, version: await bumpVersion(client, essay.id) };
  });
  sendJson(ctx.res, 201, frameBody(result.frame, result.version), { ETag: etagOf(result.version) });
});

async function frameEssay(frameId: string): Promise<FrameRow> {
  const frame = await one<FrameRow>("SELECT * FROM frames WHERE id = $1", [frameId]);
  if (!frame) throw notFound();
  return frame;
}

on("PATCH", "/api/frames/:id", "json", async (ctx: Ctx) => {
  const found = await frameEssay(ctx.params[0] ?? "");
  const result = await editableDraft(ctx, found.essay_id, async (essay, client) => {
    const { values, errors } = strictBody(ctx.body, { caption: { kind: "string", message: FRAME_CAPTION } });
    if (typeof values.caption === "string" && [...values.caption].length > 500) errors.add("caption", FRAME_CAPTION);
    errors.fail();
    const [frame] = await query<FrameRow>("UPDATE frames SET caption = $2 WHERE id = $1 RETURNING *",
      [found.id, values.caption], client);
    return { frame: frame as FrameRow, version: await bumpVersion(client, essay.id) };
  });
  sendJson(ctx.res, 200, frameBody(result.frame, result.version), { ETag: etagOf(result.version) });
});

on("DELETE", "/api/frames/:id", "none", async (ctx: Ctx) => {
  const found = await frameEssay(ctx.params[0] ?? "");
  const version = await editableDraft(ctx, found.essay_id, async (essay, client) => {
    await query("DELETE FROM frames WHERE id = $1", [found.id], client);
    await query(`UPDATE frames f SET position = r.n FROM (
        SELECT id, row_number() OVER (ORDER BY position) AS n FROM frames WHERE essay_id = $1) r
      WHERE f.id = r.id`, [essay.id], client);
    return bumpVersion(client, essay.id);
  });
  await Promise.all([keys.original(found.essay_id, found.id),
    ...VARIANTS.map((v) => keys.derivative(found.essay_id, found.id, v))].map((key) => deleteObject(key).catch(() => undefined)));
  sendNoContent(ctx.res, { ETag: etagOf(version) });
});
