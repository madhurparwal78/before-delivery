import { randomUUID } from "node:crypto";
import { Busboy, type BusboyInstance } from "@fastify/busboy";
import { MULTIPART_EXTRA, config } from "./config.js";
import { authorize, loadBoard } from "./access.js";
import { containerOf } from "../shared/order.js";
import { loadOrder, lockBoards, recordChange, renumber } from "./containers.js";
import { now } from "./clock.js";
import { one, pool, tx, type Db } from "./db.js";
import { conflict, notFound, storageUnavailable, tooLarge, unsupportedType, validation, type ApiError } from "./errors.js";
import { contentTypeOf, extensionOf, processImage, sniffFormat, uprightSize, type ProcessedImage } from "./images.js";
import { announceNewPins, getPin, insertPin, touchLastSaved } from "./pins.js";
import { deletePrefix, putObjects, storageReachable } from "./storage.js";
import { validatePinText } from "./text.js";
import type { Ctx } from "./http.js";
import type { Pin } from "../shared/types.js";

interface Upload {
  fields: Record<string, string>;
  file: Buffer | null;
  truncated: boolean;
  oversized: boolean;
}

function readMultipart(ctx: Ctx, maxFileBytes: number): Promise<Upload> {
  return new Promise((resolve) => {
    const upload: Upload = { fields: {}, file: null, truncated: false, oversized: false };
    let received = 0;
    const cap = maxFileBytes + MULTIPART_EXTRA;
    const contentType = ctx.req.headers["content-type"];
    let parser: BusboyInstance;
    try {
      if (contentType === undefined) throw new Error("not a multipart request");
      parser = new Busboy({
        headers: { ...ctx.req.headers, "content-type": contentType },
        limits: { fileSize: maxFileBytes + 1, files: 1, fields: 24, fieldSize: 65_536 },
      });
    } catch {
      ctx.req.resume();
      resolve(upload);
      return;
    }
    parser.on("field", (name, value) => {
      upload.fields[name] = value;
    });
    parser.on("file", (name, stream) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => {
        upload.truncated = true;
      });
      stream.on("end", () => {
        if (name === "image") upload.file = Buffer.concat(chunks);
      });
    });
    parser.on("error", () => resolve(upload));
    parser.on("finish", () => resolve(upload));
    ctx.req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received <= cap || upload.oversized) return;
      upload.oversized = true;
      ctx.req.unpipe(parser);
      resolve(upload);
    });
    ctx.req.pipe(parser);
  });
}

const positiveInteger = (value: string | undefined): number | null =>
  value !== undefined && /^[1-9][0-9]{0,15}$/.test(value) ? Number(value) : null;

type ImageProblem = "pixels" | "shape";

/** Pixel and shape limits; the image is never cropped. */
export function imageProblem(size: { width: number; height: number }): ImageProblem | null {
  if (size.width * size.height > config.limits.image_max_pixels) return "pixels";
  const ratio = size.width / size.height;
  return ratio < 0.5 || ratio > 2 ? "shape" : null;
}

/** Writes the original and every display version; the image exists only after storage confirms them all. */
export async function putImage(image: ProcessedImage): Promise<string> {
  const id = randomUUID();
  const extension = extensionOf(image.format);
  const contentType = contentTypeOf(image.format);
  try {
    await putObjects([
      { key: `images/${id}/original.${extension}`, body: image.original, contentType },
      ...image.variants.map((variant) => ({ key: `images/${id}/w${variant.width}.${extension}`, body: variant.data, contentType })),
    ]);
  } catch (error) {
    await deletePrefix(`images/${id}/`);
    throw error;
  }
  return id;
}

export async function insertImage(db: Db, id: string, image: ProcessedImage): Promise<void> {
  await db.query("INSERT INTO images (id, sha256, width, height, format, variants) VALUES ($1, $2, $3, $4, $5, $6)", [
    id, image.sha256, image.width, image.height, image.format, image.variants.map((variant) => variant.width),
  ]);
}

/**
 * The refusal for an image the uploader already holds on a live pin: it names the board of their earliest such pin.
 * Same pixels means the same hash at the same size, so a flat picture turned on its side is not a copy of itself.
 */
async function findDuplicate(db: Db, userId: number, image: Pick<ProcessedImage, "sha256" | "width" | "height">): Promise<ApiError | null> {
  const found = await one<{ id: number; board_id: number; board_name: string }>(
    db,
    `SELECT p.id, b.id AS board_id, b.name AS board_name
       FROM pins p JOIN images i ON i.id = p.image_id JOIN boards b ON b.id = p.board_id
      WHERE p.owner_id = $1 AND p.state = 'live' AND i.sha256 = $2 AND i.width = $3 AND i.height = $4 ORDER BY p.created_at, p.id LIMIT 1`,
    [userId, image.sha256, image.width, image.height],
  );
  return found ? conflict("duplicate_image", { pin_id: found.id, board: { id: found.board_id, name: found.board_name } }) : null;
}

export async function createPin(ctx: Ctx): Promise<Pin> {
  const me = ctx.me();
  const upload = await readMultipart(ctx, config.limits.image_max_bytes);
  const boardId = positiveInteger(upload.fields["board"]);
  if (boardId === null) throw notFound();
  const board = await loadBoard(pool, boardId, me.id);
  authorize(board, "edit_pins");
  const sectionField = upload.fields["section"];
  let sectionId: number | null = null;
  if (sectionField !== undefined && sectionField !== "") {
    sectionId = positiveInteger(sectionField);
    if (sectionId === null || containerOf(await loadOrder(pool, board.id), sectionId) === null) throw notFound();
  }
  let processed: ProcessedImage | null = null;
  let problem: ImageProblem | null = null;
  if (upload.file !== null) {
    const format = sniffFormat(upload.file);
    if (format === null) throw unsupportedType();
    if (upload.oversized || upload.truncated || upload.file.length > config.limits.image_max_bytes) throw tooLarge(config.limits.image_max_bytes);
    const size = await uprightSize(upload.file);
    if (size === null) throw validation("image", { reason: "unreadable" });
    problem = imageProblem(size);
    if (problem === null) {
      // The signature and header read, but the pixels may still not decode (a truncated or damaged file).
      processed = await processImage(upload.file, format).catch(() => {
        throw validation("image", { reason: "unreadable" });
      });
      const duplicate = await findDuplicate(pool, me.id, processed);
      if (duplicate) throw duplicate;
    }
  }
  const text = validatePinText({
    title: upload.fields["title"], description: upload.fields["description"], alt: upload.fields["alt"], source: upload.fields["source"],
  });
  if (problem !== null) throw validation("image", { reason: problem });
  if (processed === null) throw validation("image", { reason: "missing" });
  if (!storageReachable()) throw storageUnavailable();
  const imageId = await putImage(processed);
  try {
    return await tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [me.id, processed.sha256]);
      const duplicate = await findDuplicate(client, me.id, processed);
      if (duplicate) throw duplicate;
      await lockBoards(client, [board.id]);
      authorize(await loadBoard(client, board.id, me.id), "edit_pins");
      await insertImage(client, imageId, processed);
      const at = now();
      const created = await insertPin(client, {
        ownerId: me.id, boardId: board.id, sectionId, imageId, text, savedFrom: null, createdAt: at, position: 0,
      });
      await renumber(client, board.id);
      await touchLastSaved(client, board.id, at);
      const pin = await getPin(client, me.id, created);
      await recordChange(client, board.id, me, "added", { id: created, title: pin.title }, pin.section);
      await announceNewPins(client, [created]);
      return pin;
    });
  } catch (error) {
    await deletePrefix(`images/${imageId}/`);
    throw error;
  }
}
