import { randomBytes } from "node:crypto";
import { BUYER_ROLES } from "../auth.js";
import { one, pool, tx } from "../db.js";
import { ApiError, conflict, notFound, sniff, validation } from "../http.js";
import { lockedVisible, reload, reservationView, visibleReservation } from "../reservations.js";
import { ACTIVE_STATES } from "../rules.js";
import { LINK_SECONDS, deleteObject, objectExists, putObject, signedLink } from "../s3.js";
import { route, type Ctx } from "../router.js";
import { text } from "../validate.js";

type ScanKind = "licence" | "passport";

const SCAN_FIELDS: Record<ScanKind, { name: string; max: number }[]> = {
  licence: [
    { name: "licence_number", max: 40 },
    { name: "licence_state", max: 60 },
  ],
  passport: [
    { name: "full_name", max: 120 },
    { name: "nationality", max: 120 },
    { name: "passport_number", max: 120 },
  ],
};

async function upload(ctx: Ctx, kind: ScanKind) {
  return tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["attendee"]);
    if (!ACTIVE_STATES.includes(row.state)) throw conflict("invalid_transition", "This seat is no longer active.");
    if (kind === "licence" && row.licence_status === "matched") throw conflict("licence_locked", "This licence is matched and locked.");
    const form = ctx.multipart ?? { fields: {}, files: [] };
    const values: Record<string, string> = {};
    const errors: Record<string, string> = {};
    for (const field of SCAN_FIELDS[kind]) {
      const value = text(form.fields[field.name], 1, field.max);
      if (value) values[field.name] = value;
      else errors[field.name] = `Enter 1 to ${field.max} characters.`;
    }
    if (form.files.length !== 1) errors.file = form.files.length ? "Attach one file only." : "Attach a PDF, JPEG or PNG file.";
    const file = form.files[0];
    if (Object.keys(errors).length || !file) throw validation(errors);
    if (file.tooLarge) throw new ApiError(413, "file_too_large", "Files must be 10,000,000 bytes or smaller.");
    const type = sniff(file.bytes);
    if (!type) throw new ApiError(415, "unsupported_file_type", "Upload a PDF, JPEG or PNG file.");
    const key = `${kind}s/${row.id}/${randomBytes(16).toString("hex")}.${type.ext}`;
    await putObject(key, file.bytes, type.contentType);
    if (kind === "licence") {
      await db.query(
        "UPDATE reservations SET licence_number = $2, licence_state = $3, licence_key = $4, licence_status = 'submitted' WHERE id = $1",
        [row.id, values.licence_number, values.licence_state, key],
      );
    } else {
      await db.query(
        "UPDATE reservations SET passport_full_name = $2, passport_nationality = $3, passport_number = $4, passport_key = $5 WHERE id = $1",
        [row.id, values.full_name, values.nationality, values.passport_number, key],
      );
    }
    // The scan it replaces is not kept: only the current upload stays in storage.
    const replaced = kind === "licence" ? row.licence_key : row.passport_key;
    if (replaced) await deleteObject(replaced);
    return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  });
}

for (const kind of ["licence", "passport"] as const) {
  route({ method: "POST", path: `/api/reservations/:id/${kind}`, access: BUYER_ROLES, body: "multipart", handle: (ctx) => upload(ctx, kind) });
}

route({
  method: "GET",
  path: "/api/reservations/:id/licence",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, ["attendee", "registrar"]);
    if (!row.licence_key) throw notFound();
    await linkable(row.licence_key);
    return {
      status: 200,
      body: {
        licence_number: row.licence_number,
        licence_state: row.licence_state,
        status: row.licence_status,
        url: signedLink(row.licence_key),
        expires_in: LINK_SECONDS,
      },
    };
  },
});

route({
  method: "GET",
  path: "/api/reservations/:id/passport",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, ["attendee", "registrar"]);
    if (!row.passport_key) throw notFound();
    await linkable(row.passport_key);
    return {
      status: 200,
      body: {
        full_name: row.passport_full_name,
        nationality: row.passport_nationality,
        passport_number: row.passport_number,
        url: signedLink(row.passport_key),
        expires_in: LINK_SECONDS,
      },
    };
  },
});

/** Confirms the object is there before handing out a link (a MinIO outage answers 503). */
async function linkable(key: string): Promise<void> {
  if (!(await objectExists(key))) throw notFound();
}

const RECEIPTS = ["deposit-receipt", "balance-receipt", "full-receipt", "upgrade-receipt"];
const PERSONAL = ["visa-letter", "certificate"];

route({
  method: "GET",
  path: "/api/reservations/:id/documents/:kind",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const kind = ctx.params.kind ?? "";
    const allowed = RECEIPTS.includes(kind) ? (["buyer", "registrar"] as const) : PERSONAL.includes(kind) ? (["attendee", "registrar"] as const) : null;
    if (!allowed) throw notFound();
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, allowed);
    const doc = await one<{ object_key: string }>(pool, "SELECT object_key FROM documents WHERE owner_id = $1 AND kind = $2", [row.id, kind]);
    if (!doc) throw notFound();
    await linkable(doc.object_key);
    return { status: 200, body: { url: signedLink(doc.object_key), expires_in: LINK_SECONDS } };
  },
});

route({
  method: "GET",
  path: "/api/groups/:id/documents/invoice",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const groupId = ctx.params.id ?? "";
    const group = await one<{ buyer_id: string }>(pool, "SELECT buyer_id FROM groups WHERE id = $1", [groupId]);
    if (!group || (group.buyer_id !== ctx.account.id && ctx.account.role !== "registrar")) throw notFound();
    const doc = await one<{ object_key: string }>(pool, "SELECT object_key FROM documents WHERE owner_id = $1 AND kind = 'invoice'", [groupId]);
    if (!doc) throw notFound();
    await linkable(doc.object_key);
    return { status: 200, body: { url: signedLink(doc.object_key), expires_in: LINK_SECONDS } };
  },
});
