// Artwork entries stay with their artist: another artist's entry is not found on any route. Images are
// private originals (signed links for the artist and curators) plus a display copy served only once published.
import { db, transaction, type Db } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route, type SignedInCtx } from "../http.ts";
import { checkUpload, decodeImage, displayJpeg } from "../services/files.ts";
import { getObject, objectKeys, putAll } from "../services/storage.ts";
import { newId } from "./ids.ts";
import { signedLink } from "./signedLinks.ts";
import { history, move } from "./stateMachine.ts";
import { isoOrNull } from "./time.ts";
import { asObject, intOrNull, text } from "./validate.ts";

const IMAGE_LIMIT = 10_000_000;

type EntryRow = { id: string; artist_id: string; artist_name: string; title: string; statement: string; discipline: string; medium: string; year: number; status: string; publish_at: Date | null };

const ENTRY_SELECT = `SELECT e.id, e.artist_id, u.name AS artist_name, e.title, e.statement, e.discipline, e.medium, e.year,
  effective_status(e.status, e.publish_at, $1) AS status, e.publish_at FROM entries e JOIN users u ON u.id = e.artist_id`;

async function entryViews(q: Db, rows: EntryRow[]) {
  const images = await q.all<{ id: string; entry_id: string; width: number; height: number }>(
    "SELECT id, entry_id, width, height FROM entry_images WHERE entry_id = ANY($1) ORDER BY created_at", [rows.map((r) => r.id)]);
  return rows.map((r) => ({
    id: r.id, artist_id: r.artist_id, artist_name: r.artist_name, title: r.title, statement: r.statement, discipline: r.discipline,
    medium: r.medium, year: r.year, status: r.status, publish_at: isoOrNull(r.publish_at),
    images: images.filter((i) => i.entry_id === r.id).map((i) => ({
      id: i.id, width: i.width, height: i.height, display_url: r.status === "published" ? `/api/media/artworks/${i.id}` : null,
    })),
  }));
}

/** An entry is visible to its artist and to curators; to anyone else it is not found. */
async function visibleEntry(q: Db, ctx: SignedInCtx, lock = false): Promise<EntryRow> {
  const row = await q.one<EntryRow>(`${ENTRY_SELECT} WHERE e.id = $2${lock ? " FOR UPDATE OF e" : ""}`, [new Date(), ctx.params.id!]);
  if (!row || (ctx.user.role !== "curator" && row.artist_id !== ctx.user.id)) throw notFound();
  return row;
}

async function readFields(q: Db, input: Record<string, unknown>, base: Partial<EntryRow>) {
  const merged = { ...base, ...input };
  const errors: Record<string, string> = {};
  const title = text(merged.title, 1, 200);
  if (!title) errors.title = "required";
  const statement = typeof merged.statement === "string" ? merged.statement.trim().slice(0, 4000) : null;
  if (statement === null) errors.statement = "required";
  const discipline = typeof merged.discipline === "string" ? await q.one("SELECT id FROM disciplines WHERE id = $1", [merged.discipline]) : null;
  if (!discipline) errors.discipline = "unknown";
  const medium = text(merged.medium, 1, 200);
  if (!medium) errors.medium = "required";
  const year = typeof merged.year === "string" && /^\d{4}$/.test(merged.year) ? Number(merged.year) : intOrNull(merged.year);
  if (year === null || year < 1900 || year > 2100) errors.year = "out_of_range";
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  return { title: title!, statement: statement!, discipline: merged.discipline as string, medium: medium!, year: year! };
}

route("GET", "/api/entries", ["artist", "curator"], async (ctx) => {
  const rows = await db.all<EntryRow>(`${ENTRY_SELECT} WHERE ($2::text IS NULL OR e.artist_id = $2) ORDER BY e.created_at DESC, e.id`,
    [new Date(), ctx.user.role === "curator" ? null : ctx.user.id]);
  return ok({ entries: await entryViews(db, rows) });
});

route("POST", "/api/entries", ["artist"], async (ctx) => {
  const f = await readFields(db, asObject(ctx.body), {});
  const id = `e-${newId()}`;
  await db.query("INSERT INTO entries (id, artist_id, title, statement, discipline, medium, year, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)",
    [id, ctx.user.id, f.title, f.statement, f.discipline, f.medium, f.year, new Date()]);
  const row = (await db.one<EntryRow>(`${ENTRY_SELECT} WHERE e.id = $2`, [new Date(), id]))!;
  return ok((await entryViews(db, [row]))[0], 201);
});

route("GET", "/api/entries/:id", ["artist", "curator"], async (ctx) => ok((await entryViews(db, [await visibleEntry(db, ctx)]))[0]));

/** Entries are editable only by their artist and only in draft. */
function assertEditable(ctx: SignedInCtx, entry: EntryRow): void {
  if (entry.artist_id !== ctx.user.id || entry.status !== "draft") throw new ApiError(409, "not_editable");
}

route("PATCH", "/api/entries/:id", ["artist"], async (ctx) => {
  const view = await transaction(async (tx) => {
    const entry = await visibleEntry(tx, ctx, true);
    assertEditable(ctx, entry);
    const f = await readFields(tx, asObject(ctx.body), entry);
    await tx.query("UPDATE entries SET title=$2, statement=$3, discipline=$4, medium=$5, year=$6 WHERE id = $1", [entry.id, f.title, f.statement, f.discipline, f.medium, f.year]);
    return (await entryViews(tx, [(await tx.one<EntryRow>(`${ENTRY_SELECT} WHERE e.id = $2`, [new Date(), entry.id]))!]))[0];
  });
  return ok(view);
});

route("POST", "/api/entries/:id/images", ["artist"], async (ctx) => {
  const image = await transaction(async (tx) => {
    const entry = await visibleEntry(tx, ctx, true);
    assertEditable(ctx, entry);
    const checked = checkUpload(ctx.upload.file, ["image/jpeg", "image/png", "image/webp"]);
    if ("error" in checked) throw new FieldErrors({ file: checked.error });
    const pixels = decodeImage(checked.file.data, checked.type);
    const id = newId();
    await putAll([
      { key: objectKeys.artworkOriginal(entry.id, id), body: checked.file.data, contentType: checked.type },
      { key: objectKeys.artworkDisplay(entry.id, id), body: displayJpeg(pixels), contentType: "image/jpeg" },
    ]);
    await tx.query("INSERT INTO entry_images (id, entry_id, width, height, content_type, size_bytes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, entry.id, pixels.width, pixels.height, checked.type, checked.file.data.length, new Date()]);
    return { id, width: pixels.width, height: pixels.height, display_url: null };
  });
  return ok({ image }, 201);
}, { multipartLimit: IMAGE_LIMIT });

route("POST", "/api/entries/:id/images/:imageId/read", ["artist", "curator"], async (ctx) => {
  const entry = await visibleEntry(db, ctx);
  const image = await db.one("SELECT id FROM entry_images WHERE id = $1 AND entry_id = $2", [ctx.params.imageId!, entry.id]);
  if (!image) throw notFound();
  return ok(await signedLink({ kind: "artwork", id: ctx.params.imageId! }));
});

route("POST", "/api/entries/:id/transitions", ["artist", "curator"], async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const entry = await visibleEntry(tx, ctx, true);
    await move(tx, "entry", entry.id, ctx.user, { to: body.to, note: body.note, publish_at: body.publish_at }, {
      validate: async (to): Promise<Record<string, string>> => {
        if (to !== "review" || entry.status !== "draft") return {};
        const images = await tx.one("SELECT 1 FROM entry_images WHERE entry_id = $1", [entry.id]);
        return images ? {} : { images: "required" as const };
      },
    });
    const row = (await tx.one<EntryRow>(`${ENTRY_SELECT} WHERE e.id = $2`, [new Date(), entry.id]))!;
    return { entry: (await entryViews(tx, [row]))[0], history: await history(tx, "entry", entry.id) };
  });
  return ok(result);
});

route("GET", "/api/gallery", "public", async () => {
  const rows = await db.all<EntryRow>(`${ENTRY_SELECT} WHERE effective_status(e.status, e.publish_at, $1) = 'published' ORDER BY e.created_at, e.id`, [new Date()]);
  return ok({ entries: await entryViews(db, rows) });
});

route("GET", "/api/media/artworks/:imageId", "public", async (ctx) => {
  const image = await db.one<{ id: string; entry_id: string }>(
    `SELECT i.id, i.entry_id FROM entry_images i JOIN entries e ON e.id = i.entry_id
     WHERE i.id = $1 AND effective_status(e.status, e.publish_at, $2) = 'published'`, [ctx.params.imageId!, new Date()]);
  if (!image) throw notFound();
  const bytes = await getObject(objectKeys.artworkDisplay(image.entry_id, image.id));
  return { status: 200, bytes, contentType: "image/jpeg", headers: { "Cache-Control": "public, max-age=300" } };
});

export async function artworkOriginalBytes(imageId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const image = await db.one<{ entry_id: string; content_type: string }>("SELECT entry_id, content_type FROM entry_images WHERE id = $1", [imageId]);
  return image ? { bytes: await getObject(objectKeys.artworkOriginal(image.entry_id, imageId)), contentType: image.content_type } : null;
}
