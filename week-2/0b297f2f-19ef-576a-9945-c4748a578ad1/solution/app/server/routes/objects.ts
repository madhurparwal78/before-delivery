import { createHash, randomUUID } from "node:crypto";
import { read, transaction, type Db } from "../db.js";
import { ApiError, imageStoreUnavailable, notFound, validationFailed } from "../errors.js";
import { writeEvent } from "../events.js";
import { json, jsonBody, route, type Ctx, type Route } from "../http.js";
import { OBJECT_SELECT, objectById, objectsFrom, placementsWhere, requireRole, toPhoto, type ObjectRow, type PhotoRow } from "../model.js";
import { deleteObject, getObject, putObject, StoreUnavailable } from "../s3.js";
import { toMillimetres } from "../../shared/units.js";
import { idempotent, idempotentChange, isWhole, recomputeLux, recordSuccess } from "./support.js";

const MESSAGES = {
  title: "Enter a title.",
  objectNumberEmpty: "Enter an object number.",
  objectNumberUsed: "That object number is already in use.",
  lenderId: "Choose a lender or the Ashgrove collection.",
  medium: "Keep the medium to 120 characters or fewer.",
  width: "Enter a width above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.",
  height: "Enter a height above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.",
  unit: "Choose cm or in.",
  luxLimit: "Enter a lux limit from 1 to 1000.",
  luxHourBudget: "Enter a lux-hour budget from 1 to 10,000,000.",
  insuranceValueGbp: "Enter an insurance value in whole pounds.",
  registrarNote: "Keep the note to 2000 characters or fewer.",
} as const;

const MAX_MM = 20_000;

interface ObjectValues {
  title?: string;
  objectNumber?: string;
  lenderId?: string | null;
  medium?: string;
  widthMm?: number;
  heightMm?: number;
  luxLimit?: number;
  luxHourBudget?: number;
  insuranceValueGbp?: number;
  registrarNote?: string;
}

/** Validates an object form; `partial` for PATCH, where only the fields sent are checked. */
async function validate(db: Db, b: Record<string, unknown>, partial: boolean, selfId: string | null) {
  const fields: Record<string, string> = {};
  const values: ObjectValues = {};
  const has = (key: string) => !partial || b[key] !== undefined;
  const text = (key: string, fallback: string) => (b[key] === undefined && !partial ? fallback : b[key]);

  if (has("title")) {
    if (typeof b.title === "string" && b.title.trim()) values.title = b.title.trim();
    else fields.title = MESSAGES.title;
  }
  if (has("objectNumber")) {
    if (typeof b.objectNumber === "string" && b.objectNumber.trim()) {
      values.objectNumber = b.objectNumber.trim();
      const used = await db.query("SELECT 1 FROM objects WHERE lower(object_number) = lower($1) AND id <> $2", [
        values.objectNumber,
        selfId ?? "",
      ]);
      if (used.rowCount) fields.objectNumber = MESSAGES.objectNumberUsed;
    } else fields.objectNumber = MESSAGES.objectNumberEmpty;
  }
  if (has("lenderId")) {
    if (b.lenderId === null) values.lenderId = null;
    else if (typeof b.lenderId === "string" && (await db.query("SELECT 1 FROM lenders WHERE id = $1", [b.lenderId])).rowCount) {
      values.lenderId = b.lenderId;
    } else fields.lenderId = MESSAGES.lenderId;
  }
  if (has("medium")) {
    const medium = text("medium", "");
    if (typeof medium === "string" && medium.length <= 120) values.medium = medium;
    else fields.medium = MESSAGES.medium;
  }
  if (has("width") || has("height") || (partial && b.unit !== undefined)) {
    const unit = b.unit;
    if (unit !== "cm" && unit !== "in") fields.unit = MESSAGES.unit;
    else {
      for (const key of ["width", "height"] as const) {
        if (!has(key)) continue;
        const raw = b[key];
        const mm = typeof raw === "number" ? toMillimetres(raw, unit) : null;
        if (mm === null || mm < 1 || mm > MAX_MM) fields[key] = MESSAGES[key];
        else values[key === "width" ? "widthMm" : "heightMm"] = mm;
      }
    }
  }
  if (has("luxLimit")) {
    if (isWhole(b.luxLimit) && b.luxLimit >= 1 && b.luxLimit <= 1000) values.luxLimit = b.luxLimit;
    else fields.luxLimit = MESSAGES.luxLimit;
  }
  if (has("luxHourBudget")) {
    if (isWhole(b.luxHourBudget) && b.luxHourBudget >= 1 && b.luxHourBudget <= 10_000_000) values.luxHourBudget = b.luxHourBudget;
    else fields.luxHourBudget = MESSAGES.luxHourBudget;
  }
  if (has("insuranceValueGbp")) {
    if (isWhole(b.insuranceValueGbp) && b.insuranceValueGbp >= 0) values.insuranceValueGbp = b.insuranceValueGbp;
    else fields.insuranceValueGbp = MESSAGES.insuranceValueGbp;
  }
  if (has("registrarNote")) {
    const note = text("registrarNote", "");
    if (typeof note === "string" && note.length <= 2000) values.registrarNote = note;
    else fields.registrarNote = MESSAGES.registrarNote;
  }
  return { fields, values };
}

const SORTS: Record<string, string> = {
  number: "o.object_number",
  title: "lower(o.title)",
  lender: "coalesce(l.name, 'Ashgrove collection')",
  lux: "o.lux_limit",
};

async function listObjects(ctx: Ctx) {
  return read(async (db) => {
    const q = ctx.query.get("q") ?? "";
    const lender = ctx.query.get("lender");
    const sort = ctx.query.get("sort") ?? "number";
    const dir = ctx.query.get("dir") ?? "asc";
    const fields: Record<string, string> = {};
    if (q.length > 100) fields.q = "Keep the search to 100 characters or fewer.";
    if (lender !== null && lender !== "collection" && !(await db.query("SELECT 1 FROM lenders WHERE id = $1", [lender])).rowCount) {
      fields.lender = "Choose a lender id or collection.";
    }
    if (!(sort in SORTS)) fields.sort = "Sort by number, title, lender or lux.";
    if (dir !== "asc" && dir !== "desc") fields.dir = "Order asc or desc.";
    if (Object.keys(fields).length) throw validationFailed(fields);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q) {
      params.push(q.toLowerCase());
      where.push(`(position($${params.length} in lower(o.title)) > 0 OR position($${params.length} in lower(o.object_number)) > 0)`);
    }
    if (lender === "collection") where.push("o.lender_id IS NULL");
    else if (lender) {
      params.push(lender);
      where.push(`o.lender_id = $${params.length}`);
    }
    const order = `${SORTS[sort]} ${dir === "desc" ? "DESC" : "ASC"}, o.object_number ASC`;
    const { rows } = await db.query<ObjectRow>(`${OBJECT_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order}`, params);
    return json(200, { objects: await objectsFrom(db, rows) });
  });
}

async function createObject(ctx: Ctx) {
  return idempotentChange(ctx, "POST /api/objects", async (db, idem) => {
    requireRole(ctx.staff, "registrar");
    idem?.assertNoConflict();
    const { fields, values } = await validate(db, jsonBody(ctx), false, null);
    if (Object.keys(fields).length) throw validationFailed(fields);
    const id = randomUUID();
    await db.query(
      `INSERT INTO objects (id, object_number, title, medium, lender_id, width_mm, height_mm, lux_limit, lux_hour_budget,
         insurance_value_gbp, registrar_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, values.objectNumber, values.title, values.medium, values.lenderId, values.widthMm, values.heightMm,
        values.luxLimit, values.luxHourBudget, values.insuranceValueGbp, values.registrarNote],
    );
    const object = await objectById(db, id);
    const seq = await writeEvent(db, "object.created", ctx.staff, { objectId: id, title: object.title });
    return { status: 201, body: { object, seq } };
  });
}

const COLUMNS: Record<keyof ObjectValues, string> = {
  title: "title",
  objectNumber: "object_number",
  lenderId: "lender_id",
  medium: "medium",
  widthMm: "width_mm",
  heightMm: "height_mm",
  luxLimit: "lux_limit",
  luxHourBudget: "lux_hour_budget",
  insuranceValueGbp: "insurance_value_gbp",
  registrarNote: "registrar_note",
};

async function updateObject(ctx: Ctx) {
  return idempotentChange(ctx, "PATCH /api/objects/{id}", async (db, idem) => {
    const current = await objectById(db, ctx.params.id, true);
    requireRole(ctx.staff, "registrar");
    idem?.assertNoConflict();
    const { fields, values } = await validate(db, jsonBody(ctx), true, current.id);
    const resized =
      (values.widthMm !== undefined && values.widthMm !== current.widthMm) ||
      (values.heightMm !== undefined && values.heightMm !== current.heightMm);
    if (resized && current.placementId) {
      throw new ApiError(409, "object_placed", "Take the work off the wall before changing its size.");
    }
    if (Object.keys(fields).length) throw validationFailed(fields);
    const keys = Object.keys(values) as (keyof ObjectValues)[];
    if (keys.length) {
      await db.query(
        `UPDATE objects SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [current.id, ...keys.map((k) => values[k])],
      );
    }
    await recomputeLux(db, "p.object_id = $1 AND p.status <> 'removed'", [current.id]);
    const object = await objectById(db, current.id);
    const placements = await placementsWhere(db, "p.object_id = $1 AND p.status <> 'removed'", [current.id]);
    const seq = await writeEvent(db, "object.updated", ctx.staff, { objectId: current.id, title: object.title });
    return { status: 200, body: { object, placements, seq } };
  });
}

const PHOTO_TYPES: Record<string, { ext: string; magic: number[] }> = {
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

async function attachPhoto(ctx: Ctx) {
  return idempotent(ctx, "POST /api/objects/{id}/photos", async (idem) => {
    const object = await read((db) => objectById(db, ctx.params.id));
    requireRole(ctx.staff, "registrar");
    idem?.assertNoConflict();
    const contentType = String(ctx.req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const type = PHOTO_TYPES[contentType];
    if (!type) throw new ApiError(415, "unsupported_media_type", "Use a JPEG or PNG photo.");
    if (ctx.body.length === 0) throw validationFailed({ photo: "Choose a photo to attach." });
    if (!type.magic.every((byte, i) => ctx.body[i] === byte)) {
      throw new ApiError(415, "unsupported_media_type", "Use a JPEG or PNG photo.");
    }
    const id = randomUUID();
    const key = `condition/${object.id}/${id}.${type.ext}`;
    try {
      await putObject(key, ctx.body, contentType);
    } catch (error) {
      if (error instanceof StoreUnavailable) throw imageStoreUnavailable();
      throw error;
    }
    try {
      return await transaction(async (db) => {
        await db.query("SELECT 1 FROM objects WHERE id = $1 FOR UPDATE", [object.id]);
        const { rows } = await db.query<PhotoRow>(
          `INSERT INTO photos (id, object_id, key, bytes, sha256, content_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [id, object.id, key, ctx.body.length, createHash("sha256").update(ctx.body).digest("hex"), contentType],
        );
        const seq = await writeEvent(db, "photo.attached", ctx.staff, { objectId: object.id, title: object.title });
        const body = { photo: toPhoto(rows[0]), seq };
        await recordSuccess(db, idem, 201, body);
        return { status: 201, body };
      });
    } catch (error) {
      await deleteObject(key);
      throw error;
    }
  });
}

async function photoBytes(ctx: Ctx) {
  const photo = await read(async (db) => {
    const { rows } = await db.query<PhotoRow>("SELECT * FROM photos WHERE id = $1 AND object_id = $2", [ctx.params.photoId, ctx.params.id]);
    if (!rows[0]) throw notFound();
    return toPhoto(rows[0]);
  });
  let stored;
  try {
    stored = await getObject(photo.key);
  } catch (error) {
    if (error instanceof StoreUnavailable) throw imageStoreUnavailable();
    throw error;
  }
  if (!stored) throw notFound();
  return { status: 200, raw: stored.body, contentType: photo.contentType, headers: { "Cache-Control": "private, max-age=3600" } };
}

export const objectRoutes: Route[] = [
  route("GET", "/api/objects", listObjects),
  route("POST", "/api/objects", createObject),
  route("GET", "/api/objects/:id", (ctx) => read(async (db) => json(200, { object: await objectById(db, ctx.params.id) }))),
  route("PATCH", "/api/objects/:id", updateObject),
  route("POST", "/api/objects/:id/photos", attachPhoto),
  route("GET", "/api/objects/:id/photos/:photoId", photoBytes),
];
