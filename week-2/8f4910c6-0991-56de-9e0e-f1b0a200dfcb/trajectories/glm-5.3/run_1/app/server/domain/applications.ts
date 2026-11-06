import { query, one, withTransaction, type Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { randomToken, APPLICATION_SLOTS, OFFICE_META, type ApplicationSlot, type Office } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { config } from "../config.js";
import { queueEmail } from "./outbox.js";
import type { SessionMember } from "./sessions.js";

/** New-face applications: drafts, photos, minors, guardian consent and scout decisions. */

export interface ApplicationRow {
  id: string;
  token: string;
  office: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  height_cm: number | null;
  instagram_followers: number | null;
  bio: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  status: string;
  minor: boolean;
  submitted_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision: string | null;
  signed_talent_id: string | null;
  consent_id: string | null;
  created_at: Date;
}

export function applicationView(row: ApplicationRow, photos: Array<{ slot: string; width: number; height: number }>): Record<string, unknown> {
  const guardianNeeded = row.status === "awaiting_guardian" || row.minor;
  return {
    id: row.id,
    office: row.office,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    heightCm: row.height_cm,
    instagramFollowers: row.instagram_followers,
    bio: row.bio,
    guardianName: row.guardian_name,
    guardianEmail: row.guardian_email,
    status: row.status,
    minor: row.minor,
    photos: photos.map((p) => ({ slot: p.slot, url: `/api/applications/${row.id}/photos/${p.slot}`, width: p.width, height: p.height })),
    submittedAt: row.submitted_at ? toInstant(row.submitted_at) : null,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? toInstant(row.decided_at) : null,
    decision: row.decision,
    guardianNeeded,
  };
}

export async function createDraft(office: string): Promise<ApplicationRow> {
  const id = `app_${randomToken(12)}`;
  const token = randomToken(40);
  const row = await one<ApplicationRow>(
    `INSERT INTO applications (id, token, office, status) VALUES ($1, $2, $3, 'draft') RETURNING *, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth`,
    [id, token, office]
  );
  if (!row) throw new Error("insert failed");
  return row;
}

export async function loadApplication(id: string, token: string): Promise<ApplicationRow> {
  const row = await one<ApplicationRow>(
    `SELECT *, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth FROM applications WHERE id = $1 AND token = $2`,
    [id, token]
  );
  if (!row) throw errors.notFound();
  return row;
}

export async function applicationPhotos(id: string): Promise<Array<{ slot: string; width: number; height: number }>> {
  return query<{ slot: string; width: number; height: number }>(`SELECT slot, width, height FROM application_photos WHERE application_id = $1`, [id]);
}

/** A minor when their 18th birthday falls after today's date in the office's zone. */
export function isMinorOn(dateOfBirth: string, office: Office, now: Date): boolean {
  const tz = OFFICE_META[office].timeZone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [ty, tm, td] = today.split("-").map(Number);
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  let anniversaryMonth = bm;
  let anniversaryDay = bd;
  if (bm === 2 && bd === 29) {
    const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
    anniversaryDay = leap ? 29 : 1;
    anniversaryMonth = leap ? 2 : 3;
  }
  const eighteenth = new Date(Date.UTC(by + 18, anniversaryMonth - 1, anniversaryDay));
  const todayUtc = new Date(Date.UTC(ty, tm - 1, td));
  return eighteenth.getTime() > todayUtc.getTime();
}

export interface DraftPatch {
  firstName?: string;
  lastName?: string;
  email?: string;
  dateOfBirth?: string;
  office?: string;
  height?: { value: number | string };
  instagramFollowers?: number;
  bio?: string;
  guardianName?: string;
  guardianEmail?: string;
}

export async function patchDraft(row: ApplicationRow, patch: DraftPatch, now: Date): Promise<ApplicationRow> {
  if (row.status !== "draft") throw errors.conflict("already_submitted");
  const office = (patch.office || row.office) as Office;
  let minor = row.minor;
  const dob = patch.dateOfBirth !== undefined ? patch.dateOfBirth : row.date_of_birth;
  if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    minor = isMinorOn(dob, office, now);
  }
  const fields: Record<string, unknown> = { minor };
  if (patch.firstName !== undefined) fields.first_name = patch.firstName;
  if (patch.lastName !== undefined) fields.last_name = patch.lastName;
  if (patch.email !== undefined) fields.email = patch.email;
  if (patch.dateOfBirth !== undefined) fields.date_of_birth = patch.dateOfBirth;
  if (patch.office !== undefined) fields.office = patch.office;
  if (patch.height !== undefined) fields.height_cm = patch.height.value;
  if (patch.instagramFollowers !== undefined) fields.instagram_followers = patch.instagramFollowers;
  if (patch.bio !== undefined) fields.bio = patch.bio;
  if (patch.guardianName !== undefined) fields.guardian_name = patch.guardianName;
  if (patch.guardianEmail !== undefined) fields.guardian_email = patch.guardianEmail;
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${toSnake(k)} = $${i + 1}`).join(", ");
  const params = keys.map((k) => fields[k]);
  params.push(row.id);
  const fresh = await one<ApplicationRow>(
    `UPDATE applications SET ${sets} WHERE id = $${params.length} RETURNING *, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth`,
    params
  );
  if (!fresh) throw new Error("update failed");
  return fresh;
}

function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export async function uploadPhoto(row: ApplicationRow, slot: ApplicationSlot, width: number, height: number): Promise<void> {
  await query(
    `INSERT INTO application_photos (application_id, slot, width, height) VALUES ($1, $2, $3, $4)
     ON CONFLICT (application_id, slot) DO UPDATE SET width = $3, height = $4`,
    [row.id, slot, width, height]
  );
}

export async function submitApplication(row: ApplicationRow, now: Date, consentTtlSeconds: number): Promise<{ status: string; minor: boolean }> {
  if (row.status !== "draft") throw errors.conflict("already_submitted");
  const missing: Record<string, string> = {};
  if (!row.first_name) missing.firstName = "Enter first name.";
  if (!row.last_name) missing.lastName = "Enter last name.";
  if (!row.email) missing.email = "Enter an email address like name@example.com.";
  if (!row.date_of_birth) missing.dateOfBirth = "Enter date of birth.";
  if (row.height_cm === null) missing.height = "Enter height.";
  if (Object.keys(missing).length > 0) throw errors.validation(missing);
  const photos = await applicationPhotos(row.id);
  const have = new Set(photos.map((p) => p.slot));
  for (const slot of APPLICATION_SLOTS) {
    if (!have.has(slot)) missing[slot === "front" ? "frontPhoto" : slot === "profile" ? "profilePhoto" : slot === "full_length" ? "fullLengthPhoto" : "smilePhoto"] = `Add the ${slot.replace("_", " ")} photo.`;
  }
  if (row.minor) {
    if (!row.guardian_name) missing.guardianName = "Enter guardian name.";
    if (!row.guardian_email) missing.guardianEmail = "Enter an email address like name@example.com.";
  }
  if (Object.keys(missing).length > 0) throw errors.validation(missing);
  const status = row.minor ? "awaiting_guardian" : "submitted";
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE applications SET status = $2, submitted_at = $3 WHERE id = $1`, [row.id, status, now]);
    if (row.minor && row.guardian_email) {
      const consentToken = randomToken(40);
      const consentId = `con_${randomToken(10)}`;
      await tx.query(`INSERT INTO consents (id, application_id, token, expires_at) VALUES ($1, $2, $3, $4)`, [consentId, row.id, consentToken, new Date(now.getTime() + consentTtlSeconds * 1000)]);
      await tx.query(`UPDATE applications SET consent_id = $2 WHERE id = $1`, [row.id, consentId]);
      const link = `${config.baseUrl}/consent/${consentToken}`;
      await queueEmail({
        to: row.guardian_email,
        subject: `Consent needed for ${row.first_name}'s application to Vesper & Rowe`,
        body: [
          `Hello,`,
          ``,
          `${row.first_name} has applied to Vesper & Rowe Talent. Because they are under 18, a guardian must approve the application.`,
          ``,
          `Approve or decline here:`,
          ``,
          link,
          ``,
          `Vesper & Rowe Talent`,
        ].join("\r\n"),
      });
    }
  });
  return { status, minor: row.minor };
}

export async function loadConsent(token: string): Promise<{ consent: { id: string; token: string; expires_at: Date; used_at: Date | null; decision: string | null; application_id: string }; application: ApplicationRow | null }> {
  const consent = await one<{ id: string; token: string; expires_at: Date; used_at: Date | null; decision: string | null; application_id: string }>(
    `SELECT * FROM consents WHERE token = $1`,
    [token]
  );
  if (!consent) return { consent: null as never, application: null };
  if (consent.used_at || consent.expires_at.getTime() <= Date.now()) return { consent: consent, application: null };
  const application = await one<ApplicationRow>(`SELECT *, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth FROM applications WHERE id = $1`, [consent.application_id]);
  return { consent, application };
}

export async function consentView(application: ApplicationRow): Promise<Record<string, unknown>> {
  return {
    applicantFirstName: application.first_name,
    office: application.office,
  };
}

export async function recordConsent(token: string, decision: "approve" | "decline", now: Date): Promise<void> {
  await withTransaction(async (tx) => {
    const claimed = await tx.one<{ id: string; application_id: string }>(
      `UPDATE consents SET used_at = $2, decision = $3 WHERE token = $1 AND used_at IS NULL RETURNING id, application_id`,
      [token, now, decision]
    );
    if (!claimed) return;
    const status = decision === "approve" ? "submitted" : "declined";
    await tx.query(`UPDATE applications SET status = $2 WHERE id = $1`, [claimed.application_id, status]);
  });
}

export async function listApplications(status?: string): Promise<unknown[]> {
  const where = status ? `AND status = $1` : "";
  const params = status ? [status] : [];
  const rows = await query<ApplicationRow & { decided_by_name: string | null }>(
    `SELECT a.*, to_char(a.date_of_birth,'YYYY-MM-DD') AS date_of_birth, m.name AS decided_by_name
     FROM applications a LEFT JOIN members m ON m.id = a.decided_by
     WHERE a.status <> 'draft' ${where} ORDER BY a.submitted_at DESC`,
    params
  );
  const out = [];
  for (const row of rows) {
    const photos = await applicationPhotos(row.id);
    out.push({
      ...applicationView(row, photos),
      decidedBy: row.decided_by_name,
    });
  }
  return out;
}

export async function loadApplicationForStaff(id: string): Promise<ApplicationRow> {
  const row = await one<ApplicationRow>(`SELECT *, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth FROM applications WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  return row;
}

export async function decideApplication(row: ApplicationRow, decision: "approve" | "decline", member: SessionMember, now: Date): Promise<ApplicationRow> {
  if (row.status === "awaiting_guardian") throw errors.conflict("awaiting_guardian");
  if (row.status !== "submitted") {
    if (row.decided_by) {
      const who = await one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.decided_by]);
      throw errors.conflict("already_decided", { decidedBy: who?.name || "", decidedAt: toInstant(row.decided_at || now) });
    }
    throw errors.conflict("already_decided", { decidedBy: "", decidedAt: toInstant(row.decided_at || now) });
  }
  await query(`UPDATE applications SET status = $2, decision = $3, decided_by = $4, decided_at = $5 WHERE id = $1`, [
    row.id,
    decision === "approve" ? "approved" : "declined",
    decision,
    member.id,
    now,
  ]);
  return (await one<ApplicationRow>(`SELECT *, to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth FROM applications WHERE id = $1`, [row.id]))!;
}

export interface SignedTalent {
  id: string;
  slug: string;
  displayName: string;
}

export async function signApplication(tx: Tx, row: ApplicationRow): Promise<SignedTalent> {
  if (row.status !== "approved") throw errors.conflict("not_approved");
  const { createTalent } = await import("./talent.js");
  const talent = await createTalent(tx, {
    displayName: `${row.first_name} ${row.last_name}`,
    email: row.email,
    office: row.office as Office,
    board: "new_faces",
    heightCm: row.height_cm,
    instagram: row.instagram_followers || 0,
    dateOfBirth: row.date_of_birth,
    guardianName: row.guardian_name,
    guardianEmail: row.guardian_email,
  });
  const { storePortfolioPhoto, applicationKey, loadObject, portfolioKey } = await import("./storage.js");
  const photos = await applicationPhotos(row.id);
  let position = 0;
  for (const photo of photos) {
    const data = await loadObject(applicationKey(row.id, photo.slot));
    const photoId = `ph_${randomToken(12)}`;
    const normalized = await storePortfolioPhoto(talent.id, photoId, data);
    await tx.query(`INSERT INTO photos (id, talent_id, position, width, height) VALUES ($1, $2, $3, $4, $5)`, [photoId, talent.id, position++, normalized.width, normalized.height]);
  }
  await tx.query(`UPDATE talent SET portfolio_version = $2 WHERE id = $1`, [talent.id, photos.length]);
  await tx.query(`UPDATE applications SET status = 'signed', signed_talent_id = $2 WHERE id = $1`, [row.id, talent.id]);
  void portfolioKey;
  return { id: talent.id, slug: talent.slug, displayName: talent.display_name };
}
