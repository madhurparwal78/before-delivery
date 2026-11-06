// New-face applications: token-held drafts, photos, submission, guardian consent and the scout's decisions.

import type { PoolClient } from "pg";
import { exec, lockKey, one, pool, rows, tx, type Db } from "../db.js";
import { MemberCtx, memberRoute, publicRoute, json, type Ctx } from "../http.js";
import { ApiError, EMAIL_COPY, FieldErrors, conflict, gone, isoInstant, notFound, optionalInstant, required } from "../errors.js";
import { authenticate, hashToken, randomToken } from "../auth.js";
import { config } from "../config.js";
import { appLink, enqueue } from "../mail.js";
import { getObject, putObject } from "../storage.js";
import { NOT_A_PHOTO, processPhoto } from "../images.js";
import { asObject, isWholeNumber, newId, str, type Body } from "../util.js";
import { BIO_LIMIT, graphemeCount, isEmail } from "../../shared/text.js";
import { parseHeight } from "../../shared/measure.js";
import { OFFICES, addDays, isIsoDate, isOfficeId, officeToday, parseIsoDate, type OfficeId } from "../../shared/zones.js";
import { createTalent, getTalent, talentBody } from "./talent.js";

const SLOTS = ["front", "profile", "full_length", "smile"] as const;
const PHOTO_LIMIT = 8_000_000;
const OFFICE_COPY = "Choose Toronto or Vancouver.";

type Status = "draft" | "submitted" | "awaiting_guardian" | "approved" | "declined" | "signed";

interface ApplicationRow {
  id: string;
  token_hash: string;
  status: Status;
  office_id: OfficeId;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: string | null;
  height_cm: number | null;
  instagram: number | null;
  bio: string;
  guardian_name: string;
  guardian_email: string;
  consented_at: Date | null;
  submitted_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  talent_id: string | null;
}

/** A minor's 18th birthday falls after today's date in the office's zone; 29 February counts as 1 March. */
function isMinor(row: { date_of_birth: string | null; office_id: OfficeId }, now: number): boolean {
  if (!row.date_of_birth) return false;
  const { year, month, day } = parseIsoDate(row.date_of_birth);
  const target = `${year + 18}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const eighteenth = isIsoDate(target) ? target : addDays(`${year + 18}-02-28`, 1);
  return eighteenth > officeToday(row.office_id, now);
}

async function photosOf(db: Db, id: string) {
  return rows<{ slot: string; width: number; height: number }>(
    db, "SELECT slot, width, height FROM application_photos WHERE application_id = $1", [id]);
}

async function draftBody(db: Db, row: ApplicationRow, now: number) {
  return {
    id: row.id,
    status: row.status,
    office: row.office_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    height: row.height_cm === null ? null : { value: row.height_cm, unit: "cm" },
    instagramFollowers: row.instagram,
    bio: row.bio,
    guardianName: row.guardian_name,
    guardianEmail: row.guardian_email,
    minor: isMinor(row, now),
    photos: (await photosOf(db, row.id)).map((p) => ({ slot: p.slot, width: p.width, height: p.height })),
  };
}

async function staffBody(db: Db, row: ApplicationRow, now: number) {
  const photos = await photosOf(db, row.id);
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    office: row.office_id,
    heightCm: row.height_cm,
    instagramFollowers: row.instagram,
    bio: row.bio,
    status: row.status,
    minor: isMinor(row, now),
    guardianName: row.guardian_name || null,
    guardianEmail: row.guardian_email || null,
    submittedAt: optionalInstant(row.submitted_at),
    decidedBy: row.decided_by,
    decidedAt: optionalInstant(row.decided_at),
    talentId: row.talent_id,
    photos: SLOTS.filter((slot) => photos.some((p) => p.slot === slot))
      .map((slot) => ({ slot, url: `/api/applications/${row.id}/photos/${slot}` })),
  };
}

/** Step 4 for draft paths: the id and its token, or 404. */
async function heldDraft(ctx: Ctx, db: Db = pool): Promise<ApplicationRow> {
  const token = ctx.header("x-application-token");
  const row = token ? await one<ApplicationRow>(db, "SELECT * FROM applications WHERE id = $1", [ctx.params.id]) : null;
  if (!row || !token || row.token_hash !== hashToken(token)) throw notFound();
  return row;
}

publicRoute("POST", "/api/applications", async (ctx) => {
  const office = str(asObject(await ctx.json()), "office");
  if (!isOfficeId(office)) throw new ApiError(422, "validation", { errors: { office: OFFICE_COPY } });
  const id = newId();
  const token = randomToken();
  await exec(pool, "INSERT INTO applications (id, token_hash, status, office_id, created_at) VALUES ($1, $2, 'draft', $3, $4)",
    [id, hashToken(token), office, new Date(ctx.now)]);
  return json(201, { id, token, status: "draft" });
}, { rateLimit: "application_drafts" });

async function visibleApplication(ctx: MemberCtx): Promise<ApplicationRow> {
  const row = ctx.isTalent() ? null
    : await one<ApplicationRow>(pool, "SELECT * FROM applications WHERE id = $1 AND status <> 'draft'", [ctx.params.id]);
  if (!row) throw notFound();
  ctx.allow("scout", "agency_director");
  return row;
}

publicRoute("GET", "/api/applications/:id", async (ctx) => {
  if (ctx.header("x-application-token") !== undefined) return json(200, await draftBody(pool, await heldDraft(ctx), ctx.now));
  const staff = new MemberCtx(ctx, await authenticate(ctx.req, ctx.now));
  return json(200, await staffBody(pool, await visibleApplication(staff), ctx.now));
});

const TEXT_FIELDS = [["firstName", "first_name", "First name"], ["lastName", "last_name", "Last name"],
  ["guardianName", "guardian_name", "Guardian name"]] as const;

function readDraftFields(body: Body, errors: FieldErrors, today: string): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const [key, column, label] of TEXT_FIELDS) {
    if (!(key in body)) continue;
    const value = str(body, key).trim();
    if (!value) errors.add(key, required(label));
    else updates[column] = value;
  }
  for (const [key, column, label] of [["email", "email", "Email"], ["guardianEmail", "guardian_email", "Guardian email"]] as const) {
    if (!(key in body)) continue;
    const value = str(body, key).trim();
    if (!value) errors.add(key, required(label));
    else if (!isEmail(value)) errors.add(key, EMAIL_COPY);
    else updates[column] = value;
  }
  if ("dateOfBirth" in body) {
    const value = str(body, "dateOfBirth");
    if (!value) errors.add("dateOfBirth", required("Date of birth"));
    else if (!isIsoDate(value) || value > today) {
      errors.add("dateOfBirth", "Enter your date of birth like 2008-03-02.");
    } else updates.date_of_birth = value;
  }
  if ("office" in body) {
    const value = str(body, "office");
    if (!isOfficeId(value)) errors.add("office", value ? OFFICE_COPY : required("Office"));
    else updates.office_id = value;
  }
  if ("height" in body) {
    const height = asObject(body.height);
    const raw = height.value;
    const cm = raw === null || raw === undefined || raw === "" ? null
      : height.unit === "ft_in" ? parseHeight(String(raw)) : parseHeight(`${String(raw)} cm`);
    if (raw === null || raw === undefined || raw === "") errors.add("height", required("Height"));
    else if (cm === null || cm < 50 || cm > 250) errors.add("height", "Enter height like 171 or 5 ft 7 in.");
    else updates.height_cm = cm;
  }
  if ("instagramFollowers" in body) {
    const value = body.instagramFollowers;
    if (value === null || value === "") updates.instagram = null;
    else if (isWholeNumber(value) && value >= 0) updates.instagram = value;
    else if (typeof value === "string" && /^\d+$/.test(value.replace(/,/g, ""))) updates.instagram = Number(value.replace(/,/g, ""));
    else errors.add("instagramFollowers", "Enter instagram followers as a whole number.");
  }
  if ("bio" in body) {
    const bio = str(body, "bio");
    const count = graphemeCount(bio);
    if (count > BIO_LIMIT) errors.add("bio", `Your bio is ${count} characters; the limit is ${BIO_LIMIT}.`);
    else updates.bio = bio;
  }
  return updates;
}

function stillDraft(row: ApplicationRow): void {
  if (row.status !== "draft") throw conflict("already_submitted");
}

publicRoute("PATCH", "/api/applications/:id", async (ctx) => {
  const found = await heldDraft(ctx);
  const body = asObject(await ctx.json());
  return tx(async (client) => {
    await lockKey(client, `application:${found.id}`);
    const row = await heldDraft(ctx, client);
    stillDraft(row);
    const errors: FieldErrors = new FieldErrors();
    const updates = readDraftFields(body, errors, officeToday(row.office_id, ctx.now));
    errors.throwIfAny();
    const columns = Object.keys(updates);
    if (columns.length) {
      await exec(client, `UPDATE applications SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [row.id, ...columns.map((c) => updates[c])]);
    }
    return json(200, await draftBody(client, await heldDraft(ctx, client), ctx.now));
  });
});

publicRoute("PUT", "/api/applications/:id/photos/:slot", async (ctx) => {
  const row = await heldDraft(ctx);
  const slot = SLOTS.find((s) => s === ctx.params.slot);
  if (!slot) throw notFound();
  const file = await ctx.upload(PHOTO_LIMIT);
  stillDraft(row);
  if (!file || !file.data.length) throw new ApiError(422, "validation", { errors: { file: "Choose a photo to upload." } });
  const photo = await processPhoto(file.data);
  if (!photo) throw new ApiError(422, "validation", { errors: { file: NOT_A_PHOTO } });
  await putObject(`applications/${row.id}/${slot}.jpg`, photo.jpeg, "image/jpeg");
  await exec(pool, `INSERT INTO application_photos (application_id, slot, width, height) VALUES ($1, $2, $3, $4)
    ON CONFLICT (application_id, slot) DO UPDATE SET width = excluded.width, height = excluded.height`,
    [row.id, slot, photo.width, photo.height]);
  return json(200, { slot, width: photo.width, height: photo.height });
});

publicRoute("POST", "/api/applications/:id/submit", async (ctx) => {
  const found = await heldDraft(ctx);
  await ctx.json();
  return tx(async (client) => {
    await lockKey(client, `application:${found.id}`);
    const row = await heldDraft(ctx, client);
    stillDraft(row);
    const minor = isMinor(row, ctx.now);
    const errors: FieldErrors = new FieldErrors();
    for (const [key, value, label] of [["firstName", row.first_name, "First name"], ["lastName", row.last_name, "Last name"],
      ["email", row.email, "Email"], ["dateOfBirth", row.date_of_birth, "Date of birth"],
      ["height", row.height_cm, "Height"]] as const) {
      if (value === null || value === "") errors.add(key, required(label));
    }
    if ((await photosOf(client, row.id)).length < SLOTS.length) errors.add("photos", "Add all four photos.");
    if (minor && !row.guardian_name) errors.add("guardianName", required("Guardian name"));
    if (minor && !row.guardian_email) errors.add("guardianEmail", required("Guardian email"));
    errors.throwIfAny();
    const status: Status = minor ? "awaiting_guardian" : "submitted";
    await exec(client, "UPDATE applications SET status = $2, submitted_at = $3 WHERE id = $1", [row.id, status, new Date(ctx.now)]);
    if (minor) {
      const token = randomToken();
      await exec(client, "INSERT INTO consent_links (token_hash, application_id, issued_at, expires_at) VALUES ($1, $2, $3, $4)",
        [hashToken(token), row.id, new Date(ctx.now), new Date(ctx.now + config.consentLinkTtlSeconds * 1000)]);
      await enqueue(client, {
        to: row.guardian_email,
        subject: `Consent needed for ${row.first_name}'s application to Vesper & Rowe`,
        text: [`Hello ${row.guardian_name},`, "",
          `${row.first_name} has applied to Vesper & Rowe Talent in ${OFFICES[row.office_id].city}. Because ${row.first_name} is under 18, we need a guardian's consent before our scouts review the application.`,
          "", "Approve or decline here (the link works once):", appLink(`/consent/${token}`), "", "Vesper & Rowe Talent"].join("\n"),
      });
    }
    return json(200, { status, minor });
  });
});

interface ConsentRow {
  token_hash: string;
  application_id: string;
  expires_at: Date;
  used_at: Date | null;
  first_name: string;
  office_id: OfficeId;
  guardian_name: string;
}

async function usableConsent(ctx: Ctx, db: Db = pool): Promise<ConsentRow> {
  const row = await one<ConsentRow>(
    db,
    `SELECT c.token_hash, c.application_id, c.expires_at, c.used_at, a.first_name, a.office_id, a.guardian_name
       FROM consent_links c JOIN applications a ON a.id = c.application_id WHERE c.token_hash = $1`,
    [hashToken(ctx.params.token)],
  );
  if (!row) throw notFound();
  if (row.used_at) throw gone("link_used");
  if (row.expires_at.getTime() <= ctx.now) throw gone("link_expired");
  return row;
}

publicRoute("GET", "/api/consents/:token", async (ctx) => {
  const row = await usableConsent(ctx);
  return json(200, { applicantFirstName: row.first_name, office: row.office_id, expiresAt: isoInstant(row.expires_at) });
});

publicRoute("POST", "/api/consents/:token", async (ctx) => {
  await usableConsent(ctx);
  const decision = str(asObject(await ctx.json()), "decision");
  if (decision !== "approve" && decision !== "decline") {
    throw new ApiError(422, "validation", { errors: { decision: "Choose approve or decline." } });
  }
  return tx(async (client) => {
    await lockKey(client, `consent:${ctx.params.token}`);
    const row = await usableConsent(ctx, client);
    await exec(client, "UPDATE consent_links SET used_at = $2 WHERE token_hash = $1", [row.token_hash, new Date(ctx.now)]);
    await exec(
      client,
      decision === "approve"
        ? "UPDATE applications SET status = 'submitted', consented_at = $2 WHERE id = $1"
        : "UPDATE applications SET status = 'declined', decided_by = $3, decided_at = $2 WHERE id = $1",
      decision === "approve" ? [row.application_id, new Date(ctx.now)] : [row.application_id, new Date(ctx.now), row.guardian_name],
    );
    return json(200, { decision });
  });
});

memberRoute("GET", "/api/applications", async (ctx) => {
  ctx.allow("scout", "agency_director");
  const status = ctx.query.get("status");
  const found = await rows<ApplicationRow>(
    pool,
    `SELECT * FROM applications WHERE status <> 'draft' AND ($1::text IS NULL OR $1 = '' OR status = $1)
      ORDER BY submitted_at DESC NULLS LAST, id`,
    [status],
  );
  return json(200, { applications: await Promise.all(found.map((row) => staffBody(pool, row, ctx.now))) });
});

memberRoute("GET", "/api/applications/:id/photos/:slot", async (ctx) => {
  const row = await visibleApplication(ctx);
  const data = SLOTS.some((s) => s === ctx.params.slot) ? await getObject(`applications/${row.id}/${ctx.params.slot}.jpg`) : null;
  if (!data) throw notFound();
  return { status: 200, raw: data, contentType: "image/jpeg", headers: { "Cache-Control": "private, max-age=300" } };
});

async function lockedApplication(ctx: MemberCtx, client: PoolClient): Promise<ApplicationRow> {
  await lockKey(client, `application:${ctx.params.id}`);
  const row = await one<ApplicationRow>(client, "SELECT * FROM applications WHERE id = $1", [ctx.params.id]);
  if (!row) throw notFound();
  return row;
}

memberRoute("POST", "/api/applications/:id/decision", async (ctx) => {
  await visibleApplication(ctx);
  const decision = str(asObject(await ctx.json()), "decision");
  return tx(async (client) => {
    const row = await lockedApplication(ctx, client);
    if (row.status === "awaiting_guardian") throw conflict("awaiting_guardian");
    if (row.status !== "submitted") {
      throw conflict("already_decided", { decidedBy: row.decided_by ?? "", decidedAt: optionalInstant(row.decided_at) });
    }
    if (decision !== "approve" && decision !== "decline") {
      throw new ApiError(422, "validation", { errors: { decision: "Choose approve or decline." } });
    }
    await exec(client, "UPDATE applications SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1",
      [row.id, decision === "approve" ? "approved" : "declined", ctx.member.name, new Date(ctx.now)]);
    return json(200, await staffBody(client, await lockedApplication(ctx, client), ctx.now));
  });
});

memberRoute("POST", "/api/applications/:id/sign", async (ctx) => {
  await visibleApplication(ctx);
  await ctx.json();
  return tx(async (client) => {
    const row = await lockedApplication(ctx, client);
    if (row.status !== "approved") throw conflict("not_approved");
    const minor = isMinor(row, ctx.now);
    const talentId = await createTalent(client, {
      displayName: `${row.first_name} ${row.last_name}`.trim(),
      office: row.office_id,
      board: "new_faces",
      email: row.email || null,
      dateOfBirth: row.date_of_birth,
      guardianName: minor ? row.guardian_name : null,
      guardianEmail: minor ? row.guardian_email : null,
      heightCm: row.height_cm,
      instagram: row.instagram,
    }, ctx.member.name);
    const photos = await photosOf(client, row.id);
    for (const [index, slot] of SLOTS.entries()) {
      const photo = photos.find((p) => p.slot === slot);
      const data = photo ? await getObject(`applications/${row.id}/${slot}.jpg`) : null;
      if (!photo || !data) continue;
      const photoId = newId();
      await putObject(`portfolio/${talentId}/${photoId}.jpg`, data, "image/jpeg");
      await exec(client, "INSERT INTO photos (id, talent_id, position, width, height) VALUES ($1, $2, $3, $4, $5)",
        [photoId, talentId, index + 1, photo.width, photo.height]);
    }
    await exec(client, "UPDATE applications SET status = 'signed', talent_id = $2 WHERE id = $1", [row.id, talentId]);
    return json(201, { talent: await talentBody(client, await getTalent(client, talentId)) });
  });
});
