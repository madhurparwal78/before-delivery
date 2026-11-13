import { carriageQuote } from "./carrier";
import { activeShareToken, findClaim, issueShareToken, newToken, partOf, recordState, requireSameReference, shareView, type ClaimRow, type LiveClaimRow } from "./claims";
import { iso, isValidCalendarDate, now, today } from "./clock";
import { config } from "./config";
import { json, type Context, type Reply, type Route } from "./context";
import { database, one, rows, transaction } from "./db";
import { fail, failFields, unknownPartOrModel } from "./errors";
import { decodeCursor, listModels, listParts, modelDetail } from "./catalogue";
import { sendMail } from "./mailer";
import { confirmationNotice } from "./notices";
import { integerIn, isObject } from "./parse";
import { BOOKLET_RANGE, QUANTITY_RANGE, applyAction, judgePhoto, linkState, newReference, postcodeArea } from "./rules";
import { deleteClaimObjects, photoKey, putObject } from "./storage";
import type { Lang } from "../shared/types";

// ---- catalogue -------------------------------------------------------------------------------

async function models(): Promise<Reply> {
  return json(200, { models: await listModels(await database()) });
}

async function modelBySlug(ctx: Context): Promise<Reply> {
  const detail = await modelDetail(await database(), ctx.params["slug"] ?? "");
  return detail ? json(200, detail) : unknownPartOrModel();
}

const PARTS_DEFAULT = 20;
const PARTS_MAX = 50;

async function partsList(ctx: Context): Promise<Reply> {
  const fields: Record<string, string> = {};
  const rawLimit = ctx.query.get("limit");
  let limit = PARTS_DEFAULT;
  if (rawLimit !== null) {
    if (/^\d+$/.test(rawLimit) && Number(rawLimit) >= 1) limit = Math.min(Number(rawLimit), PARTS_MAX);
    else fields["limit"] = "invalid";
  }
  const rawCursor = ctx.query.get("cursor");
  const after = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && after === null) fields["cursor"] = "invalid";
  if (Object.keys(fields).length > 0) return failFields(fields);
  const page = await listParts(await database(), ctx.query.get("model"), limit, after);
  return json(200, { parts: page.parts, next_cursor: page.next });
}

// ---- carriage estimate -----------------------------------------------------------------------

async function carriageEstimate(ctx: Context): Promise<Reply> {
  const db = await database();
  const model = ctx.query.get("model") ?? "";
  const partText = ctx.query.get("part");
  const booklet = integerIn(partText, ...BOOKLET_RANGE);
  let part = null;
  if (model !== "" && typeof booklet === "number") {
    part = await partOf(db, model, booklet);
    if (!part) return unknownPartOrModel();
    if (part.status === "withdrawn") return fail("part_withdrawn", { number: booklet });
  }
  const fields: Record<string, string> = {};
  if (model === "") fields["model"] = "required";
  if (typeof booklet === "string") fields["part"] = booklet;
  const quantity = integerIn(ctx.query.get("quantity"), ...QUANTITY_RANGE);
  if (typeof quantity === "string") fields["quantity"] = quantity;
  const postcode = ctx.query.get("postcode") ?? "";
  const area = postcodeArea(postcode);
  if (postcode === "") fields["postcode"] = "required";
  else if (area === null) fields["postcode"] = "invalid";
  if (Object.keys(fields).length > 0 || !part || typeof quantity !== "number" || area === null) return failFields(fields);
  const estimate = await carriageQuote({ weightG: part.weight_g * quantity, longestSideMm: part.longest_side_mm, postcodeArea: area });
  return json(200, estimate);
}

// ---- claim start -----------------------------------------------------------------------------

interface UploadedFile {
  filename: string;
  data: Buffer;
}

interface Multipart {
  fields: Record<string, string>;
  files: UploadedFile[];
}

function parseMultipart(body: Buffer, contentType: string): Multipart {
  const result: Multipart = { fields: {}, files: [] };
  const boundaryText = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryText?.[1] ?? boundaryText?.[2];
  if (!boundary) return result;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length;
    if (body.subarray(headerStart, headerStart + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, headerStart);
    if (next === -1) break;
    const part = body.subarray(headerStart + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const headers = part.subarray(0, split).toString("utf8");
      const data = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      if (name === "photos" && filename !== undefined) result.files.push({ filename, data });
      else if (name !== undefined && filename === undefined) result.fields[name] = data.toString("utf8");
    }
    start = next;
  }
  return result;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ClaimStart {
  name: string;
  email: string;
  postcode: string;
  model: string;
  booklet: number;
  quantity: number;
  purchaseDate: string;
  description: string;
  language: Lang;
  photos: { data: Buffer; contentType: string }[];
}

function validateStart(form: Multipart, hasPart: boolean): ClaimStart {
  const f = form.fields;
  const fields: Record<string, string> = {};
  const name = (f["name"] ?? "").trim();
  if (name === "") fields["name"] = "required";
  else if ([...name].length > 120) fields["name"] = "too_long";
  const email = (f["email"] ?? "").trim();
  if (email === "") fields["email"] = "required";
  else if (!EMAIL.test(email) || email.length > 254) fields["email"] = "invalid";
  const postcode = (f["postcode"] ?? "").trim();
  if (postcode === "") fields["postcode"] = "required";
  else if (postcodeArea(postcode) === null) fields["postcode"] = "invalid";
  const model = f["model"] ?? "";
  if (model === "") fields["model"] = "required";
  const booklet = integerIn(f["booklet_number"], ...BOOKLET_RANGE);
  if (typeof booklet === "string") fields["booklet_number"] = booklet;
  const quantity = integerIn(f["quantity"], ...QUANTITY_RANGE);
  if (typeof quantity === "string") fields["quantity"] = quantity;
  const purchaseDate = (f["purchase_date"] ?? "").trim();
  if (purchaseDate === "") fields["purchase_date"] = "required";
  else if (!isValidCalendarDate(purchaseDate)) fields["purchase_date"] = "invalid";
  else if (purchaseDate > today()) fields["purchase_date"] = "in_future";
  const description = f["description"] ?? "";
  if ([...description].length > 1000) fields["description"] = "too_long";
  const language = f["language"];
  if (language !== "en-GB" && language !== "pl-PL") fields["language"] = "invalid";
  const photos: ClaimStart["photos"] = [];
  if (form.files.length < 1 || form.files.length > 4) fields["photos"] = "count";
  form.files.forEach((file, index) => {
    const verdict = judgePhoto(file.data);
    if (verdict.ok) photos.push({ data: file.data, contentType: verdict.contentType });
    else fields[`photos.${index + 1}`] = verdict.code;
  });
  if (Object.keys(fields).length > 0 || !hasPart || typeof booklet !== "number" || typeof quantity !== "number") return failFields(fields);
  return { name, email, postcode, model, booklet, quantity, purchaseDate, description, language: language as Lang, photos };
}

async function startClaim(ctx: Context): Promise<Reply> {
  const form = parseMultipart(ctx.body, ctx.contentType);
  const db = await database();
  const model = form.fields["model"] ?? "";
  const booklet = integerIn(form.fields["booklet_number"], ...BOOKLET_RANGE);
  let hasPart = false;
  if (model !== "" && typeof booklet === "number") {
    const part = await partOf(db, model, booklet);
    if (!part) return unknownPartOrModel();
    if (part.status === "withdrawn") return fail("part_withdrawn", { number: booklet });
    hasPart = true;
  }
  const start = validateStart(form, hasPart);
  const startedAt = now();
  const confirmBy = new Date(startedAt.getTime() + config.desk.confirmLinkTtlSeconds * 1000);
  const token = newToken();
  const reference = await transaction(async (tx) => {
    let created = "";
    for (;;) {
      created = newReference();
      const inserted = await rows(
        tx,
        `INSERT INTO claims (reference, state, language, name, email, postcode, purchase_date, model_slug, booklet_number, quantity, description, started_at, confirm_by, confirm_token)
         VALUES ($1, 'started', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (reference) DO NOTHING RETURNING reference`,
        [created, start.language, start.name, start.email, start.postcode, start.purchaseDate, start.model, start.booklet, start.quantity, start.description, startedAt, confirmBy, token],
      );
      if (inserted.length > 0) break;
    }
    await rows(tx, "INSERT INTO claim_history (claim_reference, seq, state, at) VALUES ($1, 1, 'started', $2)", [created, startedAt]);
    try {
      let index = 0;
      for (const photo of start.photos) {
        index += 1;
        await putObject(photoKey(created, index), photo.data, photo.contentType);
        await rows(tx, "INSERT INTO claim_photos (claim_reference, idx, content_type, bytes) VALUES ($1, $2, $3, $4)", [created, index, photo.contentType, photo.data.length]);
      }
      const notice = confirmationNotice(created, start.language, token, confirmBy);
      await sendMail(start.email, notice.subject, notice.body);
    } catch (error) {
      await deleteClaimObjects(created).catch(() => undefined);
      throw error;
    }
    return created;
  });
  return json(201, { reference, state: "started", confirm_by: iso(confirmBy) });
}

// ---- confirmation ----------------------------------------------------------------------------

async function confirmationStatus(ctx: Context): Promise<Reply> {
  const claim = await findClaim(await database(), ctx.params["reference"], "owner", { unknown: "claim_unknown" });
  const confirmBy = claim.confirm_by as Date;
  return json(200, { reference: claim.reference, link_state: linkState(claim.state, confirmBy, now()), confirm_by: iso(confirmBy) });
}

/** Confirming from the emailed link: another claim's reference, a share token or an unknown token all answer link_unknown. */
async function confirmClaim(ctx: Context): Promise<Reply> {
  const body = isObject(ctx.json) ? ctx.json : {};
  const token = typeof body["token"] === "string" ? body["token"] : "";
  const confirmed = await transaction(async (db) => {
    const claim = token === "" ? null : await one<ClaimRow>(db, "SELECT * FROM claims WHERE confirm_token = $1 FOR UPDATE", [token]);
    if (!claim) return "reference" in body || token !== "" ? fail("link_unknown") : failFields({ token: "required" });
    requireSameReference(body, claim, "link_unknown");
    const at = now();
    const link = linkState(claim.state, claim.confirm_by as Date, at);
    if (link === "used") return fail("link_used");
    if (link === "lapsed") return fail("link_lapsed");
    const next = applyAction("confirm", claim.state);
    await rows(db, "UPDATE claims SET confirmed_at = $2 WHERE reference = $1", [claim.reference, at]);
    await recordState(db, claim, next, at);
    return { reference: claim.reference, share: await issueShareToken(db, claim.reference, at) };
  });
  return json(200, { reference: confirmed.reference, state: "confirmed", share_url: `/s/${confirmed.share}` });
}

// ---- find my claim ---------------------------------------------------------------------------

interface AttemptRow {
  wrong_count: number;
  locked_until: Date | null;
}

const LOCK_AFTER = 5;

async function lookupClaim(ctx: Context): Promise<Reply> {
  const body = isObject(ctx.json) ? ctx.json : {};
  const referenceText = typeof body["reference"] === "string" ? body["reference"] : "";
  const emailText = typeof body["email"] === "string" ? body["email"] : "";
  if (referenceText === "") return failFields({ reference: "required", ...(emailText === "" ? { email: "required" } : {}) });
  const outcome = await transaction(async (db) => {
    const claim = await findClaim(db, referenceText, "owner", { lock: true });
    const at = now();
    const attempt = await one<AttemptRow>(db, "SELECT wrong_count, locked_until FROM reference_attempts WHERE reference = $1", [claim.reference]);
    if (attempt?.locked_until && attempt.locked_until.getTime() > at.getTime()) {
      return fail("reference_locked", { retryAfter: Math.max(1, Math.ceil((attempt.locked_until.getTime() - at.getTime()) / 1000)) });
    }
    if (emailText === "") return failFields({ email: "required" });
    if ((claim as LiveClaimRow).email.toLowerCase() !== emailText.toLowerCase()) {
      const wrong = (attempt?.wrong_count ?? 0) + 1;
      const locks = wrong >= LOCK_AFTER;
      await rows(
        db,
        `INSERT INTO reference_attempts (reference, wrong_count, locked_until) VALUES ($1, $2, $3)
         ON CONFLICT (reference) DO UPDATE SET wrong_count = $2, locked_until = $3`,
        [claim.reference, locks ? 0 : wrong, locks ? new Date(at.getTime() + config.desk.referenceLockSeconds * 1000) : null],
      );
      return null;
    }
    await rows(db, "DELETE FROM reference_attempts WHERE reference = $1", [claim.reference]);
    return claim;
  });
  if (!outcome) return fail("not_found");
  if (outcome.state === "started") return fail("wrong_state", { state: "started" });
  if (outcome.state === "closed") return fail("claim_closed");
  const token = await activeShareToken(await database(), outcome.reference);
  return token ? json(200, { share_url: `/s/${token}` }) : fail("link_withdrawn");
}

// ---- share page ------------------------------------------------------------------------------

async function shareClaim(ctx: Context): Promise<Reply> {
  const db = await database();
  const found = await one<{ state: string; claim_reference: string }>(db, "SELECT state, claim_reference FROM share_tokens WHERE token = $1", [ctx.params["token"] ?? ""]);
  if (!found) return fail("share_unknown");
  if (found.state === "withdrawn") return fail("link_withdrawn");
  const claim = await findClaim(db, found.claim_reference, "owner", { unknown: "share_unknown" });
  if (claim.state === "closed") return fail("claim_closed");
  return json(200, await shareView(db, claim));
}

export const ownerRoutes: Route[] = [
  { method: "GET", template: "/api/models", body: "none", auth: "public", handler: models },
  { method: "GET", template: "/api/models/:slug", body: "none", auth: "public", handler: modelBySlug },
  { method: "GET", template: "/api/parts", body: "none", auth: "public", limited: true, handler: partsList },
  { method: "GET", template: "/api/carriage-estimate", body: "none", auth: "public", handler: carriageEstimate },
  { method: "POST", template: "/api/claims", body: "multipart", auth: "public", handler: startClaim },
  { method: "GET", template: "/api/claims/:reference/confirmation", body: "none", auth: "public", handler: confirmationStatus },
  { method: "POST", template: "/api/claims/confirm", body: "json", auth: "public", handler: confirmClaim },
  { method: "POST", template: "/api/claims/lookup", body: "json", auth: "public", handler: lookupClaim },
  { method: "*", template: "/api/share/:token", body: "none", auth: "public", handler: shareClaim },
];

