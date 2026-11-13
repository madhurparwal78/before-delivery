// Board photos: three objects per accepted photo, display and thumbnail for the public boards,
// the untouched original for yard staff only.
import { one, pool, withTransaction } from "../db";
import { ApiError, isStaff, requireRole, requireUser, route, type Context } from "../http";
import { hasSignature, makeCopies, type PhotoType } from "../images";
import { Unreachable } from "../services";
import { deleteQuietly, getObject, putObject } from "../storage";
import { boardRow, isOpen, isPublicStatus, nextId, notFound, now } from "../store";
import { visibleBoard } from "./boards";

const MAX_PHOTOS = 8;

route("POST", "/api/boards/:tag/photos", async (ctx) => {
  const user = requireUser(ctx);
  const tag = ctx.params["tag"] ?? "";
  const board = await visibleBoard(ctx, tag);
  requireRole(user, "owner", "hand");
  if (!isOpen(board.status)) throw new ApiError("board_state");
  const type = ctx.contentType as PhotoType;
  if (!hasSignature(ctx.raw, type)) throw new ApiError("unsupported_media_type");
  let copies;
  try {
    copies = makeCopies(ctx.raw, type);
  } catch {
    throw new ApiError("validation", { photo: "This photo could not be read, or is over 40,000,000 pixels." });
  }
  const count = await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM photos WHERE board_tag = $1", [tag]);
  if ((count?.n ?? 0) >= MAX_PHOTOS) throw new ApiError("validation", { photo: "A board holds at most 8 photos." });
  const id = await nextId(pool, "photo_seq", "PH");
  const ext = type === "image/jpeg" ? "jpg" : "png";
  const prefix = `photos/${tag}/${id}`;
  const objects: [string, Buffer][] = [
    [`${prefix}/original.${ext}`, ctx.raw], [`${prefix}/display.${ext}`, copies.display], [`${prefix}/thumb.${ext}`, copies.thumb],
  ];
  const written: string[] = [];
  try {
    for (const [key, bytes] of objects) {
      await putObject(key, bytes, type);
      written.push(key);
    }
  } catch (error) {
    await deleteQuietly(written);
    if (error instanceof Unreachable) throw new ApiError("storage_unavailable");
    throw error;
  }
  await withTransaction(async (db) => {
    await db.query("INSERT INTO photos (id, board_tag, ext, content_type, width, height, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, tag, ext, type, copies.width, copies.height, now()]);
  });
  return {
    status: 201,
    body: { photo: { id, url: `/api/photos/${id}`, thumb_url: `/api/photos/${id}/thumb`, original_url: `/api/photos/${id}/original`,
      key: `${prefix}/original.${ext}`, width: copies.width, height: copies.height } },
  };
}, "photo");

interface PhotoRow {
  id: string;
  board_tag: string;
  ext: string;
}

async function servePhoto(ctx: Context, variant: "display" | "thumb" | "original") {
  const staff = isStaff(ctx.user);
  const photo = await one<PhotoRow>(pool, "SELECT id, board_tag, ext FROM photos WHERE id = $1", [ctx.params["id"] ?? ""]);
  const board = photo ? await boardRow(pool, photo.board_tag) : undefined;
  if (photo === undefined || board === undefined || !(staff || isPublicStatus(board.status))) notFound();
  if (variant === "original" && !staff) notFound();
  try {
    const { bytes, contentType } = await getObject(`photos/${photo.board_tag}/${photo.id}/${variant}.${photo.ext}`);
    return { status: 200, raw: { bytes, contentType, headers: { "X-Content-Type-Options": "nosniff" } } };
  } catch (error) {
    if (error instanceof Unreachable) throw new ApiError("storage_unavailable");
    throw error;
  }
}

route("GET", "/api/photos/:id", (ctx) => servePhoto(ctx, "display"));
route("GET", "/api/photos/:id/thumb", (ctx) => servePhoto(ctx, "thumb"));
route("GET", "/api/photos/:id/original", (ctx) => {
  requireUser(ctx);
  return servePhoto(ctx, "original");
});
