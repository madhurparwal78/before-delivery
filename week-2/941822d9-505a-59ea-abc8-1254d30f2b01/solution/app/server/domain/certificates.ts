import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { claimRow, db, one, tx, type Db } from "../db.js";
import { conflict, forbidden, isUnavailable, notFound, Validation } from "../http/errors.js";
import { certificatePdf } from "../services/pdf.js";
import { getObject, putOnce } from "../services/storage.js";
import { config } from "../config.js";
import { awardedQuarters, formatHours } from "./amounts.js";
import { isId } from "./courses.js";
import { canReadEnrolment, type EnrolmentRow } from "./enrolments.js";
import { nudgeOutbox, queueMail } from "./outbox.js";
import { provider, providerToday } from "./provider.js";
import { monDYyyy } from "./time.js";
import type { SessionUser } from "./users.js";

type VersionState = "sealing" | "sealed" | "reissued" | "revoked";

export interface CertificateRow {
  id: string;
  serial: string;
  state: "sealing" | "sealed" | "revoked";
  contact_quarters: number;
  verified_module_count: number;
  issued_on: string | null;
  enrolment_id: string;
  learner_id: string;
  learner_email: string;
  funding: EnrolmentRow["funding"];
  funding_hospital_id: string | null;
  course_title: string;
}

interface VersionRow {
  certificate_id: string;
  version: number;
  state: VersionState;
  nurse_name: string;
  sealed_on: string | null;
}

export const CERTIFICATE_SELECT = `
  SELECT x.id, x.serial, x.state, x.contact_quarters, x.verified_module_count, x.issued_on, x.enrolment_id, x.learner_id,
         u.email AS learner_email, e.funding, e.funding_hospital_id, c.title AS course_title
    FROM certificates x JOIN enrolments e ON e.id = x.enrolment_id JOIN courses c ON c.id = e.course_id
    JOIN users u ON u.id = x.learner_id`;

/** The current version: the newest sealed or revoked version, or version 1 while none has been sealed. */
function currentVersion<V extends Pick<VersionRow, "version" | "state">>(versions: readonly V[]): V {
  const settled = versions.filter((v) => v.state === "sealed" || v.state === "revoked");
  const pick = settled.length > 0 ? settled : versions.filter((v) => v.version === 1);
  return pick.reduce((a, b) => (b.version > a.version ? b : a));
}

const pdfKey = (serial: string, version: number): string => `certificates/${provider.slug}/${serial}/v${version}.pdf`;

const versionsOf = (t: Db, ids: readonly string[]): Promise<VersionRow[]> =>
  t.q<VersionRow>(
    "SELECT certificate_id, version, state, nurse_name, sealed_on FROM certificate_versions WHERE certificate_id = ANY($1::uuid[]) ORDER BY version",
    [ids],
  );

export interface CertificateView {
  row: CertificateRow;
  versions: VersionRow[];
  current: VersionRow;
  reissuePending: boolean;
}

const buildView = (row: CertificateRow, versions: VersionRow[]): CertificateView => ({
  row,
  versions,
  current: currentVersion(versions),
  reissuePending: versions.some((v) => v.version > 1 && v.state === "sealing"),
});

export async function certificateViews(t: Db, rows: readonly CertificateRow[]): Promise<CertificateView[]> {
  const versions = await versionsOf(t, rows.map((r) => r.id));
  return rows.map((row) => buildView(row, versions.filter((v) => v.certificate_id === row.id)));
}

export const certificateView = async (t: Db, row: CertificateRow): Promise<CertificateView> => buildView(row, await versionsOf(t, [row.id]));

/** The Certificate object; every copy carries the current version's nurse name. */
export const certificateJson = (view: CertificateView): Record<string, unknown> => ({
  id: view.row.id,
  serial: view.row.serial,
  state: view.row.state,
  version: view.current.version,
  reissue_pending: view.reissuePending,
  nurse_name: view.current.nurse_name,
  course_title: view.row.course_title,
  contact_hours: formatHours(view.row.contact_quarters),
  issued_on: view.row.issued_on,
  enrolment_id: view.row.enrolment_id,
  verified_module_count: view.row.verified_module_count,
  versions: view.versions.map((v) => ({ version: v.version, state: v.state, sealed_on: v.sealed_on, nurse_name: v.nurse_name })),
});

export async function certificatesJson(t: Db, rows: readonly CertificateRow[]): Promise<Record<string, unknown>[]> {
  return (await certificateViews(t, rows)).map(certificateJson);
}

export async function certificateRow(t: Db, id: unknown): Promise<CertificateRow | undefined> {
  if (!isId(id)) return undefined;
  return one<CertificateRow>(t, `${CERTIFICATE_SELECT} WHERE x.id = $1`, [id]);
}

/** Readable by its learner, the planner and the funding hospital's coordinator; anyone else gets 404. */
export async function readableCertificate(t: Db, viewer: SessionUser, id: unknown): Promise<CertificateView> {
  const row = await certificateRow(t, id);
  if (!row || !canReadEnrolment(viewer, row)) throw notFound();
  return certificateView(t, row);
}

export async function certificateById(t: Db, id: string): Promise<Record<string, unknown>> {
  const row = await certificateRow(t, id);
  if (!row) throw notFound();
  return certificateJson(await certificateView(t, row));
}

/**
 * Creates the certificate (version 1, sealing) in the transaction that accepts the evaluation and completes the
 * enrolment. Returns the existing certificate id when the enrolment already has one.
 */
export async function createCertificate(
  t: Db,
  enrolment: EnrolmentRow,
  nurse: SessionUser,
  moduleCount: number,
  origin: string,
  now: Date,
): Promise<string> {
  const id = randomUUID();
  const year = providerToday(now).slice(0, 4);
  const [sequence] = await t.q<{ n: number }>("SELECT nextval('certificate_serial_seq') AS n");
  const serial = `SPL-${year}-${String(sequence?.n ?? 0).padStart(6, "0")}`;
  await t.q(
    `INSERT INTO certificates (id, enrolment_id, learner_id, serial, state, contact_quarters, verified_module_count, created_at)
     VALUES ($1, $2, $3, $4, 'sealing', $5, $6, $7)`,
    [id, enrolment.id, nurse.id, serial, awardedQuarters(enrolment.verified_minutes), moduleCount, now],
  );
  await t.q(
    "INSERT INTO certificate_versions (certificate_id, version, state, nurse_name, origin, created_at) VALUES ($1, 1, 'sealing', $2, $3, $4)",
    [id, nurse.display_name, origin, now],
  );
  return id;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

let downloadKey: Buffer | undefined;

/** The key that signs download links, made once per database at start so every instance signs and checks alike. */
async function downloadSigningKey(): Promise<Buffer> {
  if (!downloadKey) {
    const row = await one<{ secret: string }>(db, "SELECT secret FROM signing_keys WHERE name = 'download'", []);
    if (!row) throw new Error("download signing key missing: run the migration");
    downloadKey = Buffer.from(row.secret, "base64url");
  }
  return downloadKey;
}

/** The signature binding a link's nonce to one certificate, one version and its expiry. */
const downloadSignature = (key: Buffer, certificateId: string, version: number, expiresAt: Date, nonce: string): string =>
  createHmac("sha256", key).update(`${certificateId}.${version}.${expiresAt.getTime()}.${nonce}`).digest("base64url");

/** The emailed download link: a signed token bound to one certificate and one version, expiring after its lifetime. */
async function downloadLink(t: Db, certificateId: string, version: number, origin: string, now: Date): Promise<{ url: string; expiresAt: Date }> {
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + config.clock.downloadLinkTtlMs);
  const token = `${nonce}.${downloadSignature(await downloadSigningKey(), certificateId, version, expiresAt, nonce)}`;
  await t.q("INSERT INTO download_tokens (token_hash, certificate_id, version, expires_at) VALUES ($1, $2, $3, $4)", [
    hashToken(token),
    certificateId,
    version,
    expiresAt,
  ]);
  return { url: `${origin}/api/certificates/${certificateId}/pdf?token=${token}`, expiresAt };
}

/** The version a download token opens, when its signature holds for this certificate and it is not yet expired. */
export async function versionForDownloadToken(certificateId: string, token: string, at: Date): Promise<number | null> {
  const [nonce, signature, extra] = token.split(".");
  if (!nonce || !signature || extra !== undefined) return null;
  const row = await one<{ version: number; expires_at: Date; certificate_id: string }>(
    db,
    "SELECT version, expires_at, certificate_id FROM download_tokens WHERE token_hash = $1",
    [hashToken(token)],
  );
  if (!row || row.certificate_id !== certificateId || at.getTime() >= row.expires_at.getTime()) return null;
  const expected = Buffer.from(downloadSignature(await downloadSigningKey(), certificateId, row.version, row.expires_at, nonce));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? row.version : null;
}

/** The certificate email body: only the private-field allow-list (name, course, hours, serial, issue date, version, provider). */
function certificateMail(cert: CertificateRow, nurseName: string, issuedOn: string, version: number, link: { url: string; expiresAt: Date }): string {
  return [
    `Hello ${nurseName},`,
    "",
    version === 1 ? "Your continuing-education certificate is sealed." : `Your certificate has been reissued as version ${version}.`,
    "",
    `Nurse: ${nurseName}`,
    `Course: ${cert.course_title}`,
    `Contact hours: ${formatHours(cert.contact_quarters)}`,
    `Serial: ${cert.serial}`,
    `Issued: ${monDYyyy(issuedOn)}`,
    ...(version > 1 ? [`Version: ${version}`] : []),
    "",
    "Download your certificate PDF:",
    link.url,
    `This download link stops working at ${link.expiresAt.toISOString()}.`,
    "",
    provider.name,
    provider.accreditationStatement,
  ].join("\n");
}

/**
 * Seals one version: stores its PDF (never overwriting), then in one transaction marks it sealed, supersedes the
 * previous version, certifies the enrolment and queues exactly one email. Returns false while storage is down.
 */
export async function sealVersion(certificateId: string, version: number, now: Date): Promise<boolean> {
  const lease = await db.q<{ nurse_name: string; origin: string }>(
    `UPDATE certificate_versions SET lease_until = now() + interval '60 seconds'
      WHERE certificate_id = $1 AND version = $2 AND state = 'sealing' AND (lease_until IS NULL OR lease_until < now())
      RETURNING nurse_name, origin`,
    [certificateId, version],
  );
  const claimed = lease[0];
  const cert = await certificateRow(db, certificateId);
  if (!claimed || !cert) return false;
  const sealedOn = providerToday(now);
  const issuedOn = cert.issued_on ?? sealedOn;
  try {
    const pdf = certificatePdf({
      providerName: provider.name,
      accreditationStatement: provider.accreditationStatement,
      nurseName: claimed.nurse_name,
      courseTitle: cert.course_title,
      contactHours: formatHours(cert.contact_quarters),
      serial: cert.serial,
      issuedOn,
      version,
    });
    await putOnce(pdfKey(cert.serial, version), pdf, "application/pdf");
  } catch (error) {
    await db.q("UPDATE certificate_versions SET lease_until = NULL WHERE certificate_id = $1 AND version = $2", [certificateId, version]);
    if (isUnavailable(error, "storage_unavailable")) return false;
    throw error;
  }
  await tx(async (t) => {
    const sealed = await t.q(
      "UPDATE certificate_versions SET state = 'sealed', sealed_on = $3, lease_until = NULL WHERE certificate_id = $1 AND version = $2 AND state = 'sealing' RETURNING version",
      [certificateId, version, sealedOn],
    );
    if (sealed.length === 0) return;
    if (version === 1) {
      await t.q("UPDATE certificates SET state = 'sealed', issued_on = $2 WHERE id = $1 AND state = 'sealing'", [certificateId, sealedOn]);
      await t.q("UPDATE enrolments SET state = 'certified' WHERE id = $1 AND state = 'completed'", [cert.enrolment_id]);
    } else {
      await t.q("UPDATE certificate_versions SET state = 'reissued' WHERE certificate_id = $1 AND version < $2 AND state = 'sealed'", [certificateId, version]);
    }
    const link = await downloadLink(t, certificateId, version, claimed.origin, now);
    await queueMail(
      t,
      {
        eventKey: `certificate:${certificateId}:v${version}`,
        to: cert.learner_email,
        subject: version === 1 ? `Your Credwell certificate: ${cert.course_title}` : `Your reissued Credwell certificate: ${cert.course_title}`,
        text: certificateMail(cert, claimed.nurse_name, issuedOn, version, link),
      },
      now,
    );
  });
  nudgeOutbox();
  return true;
}

/** Retries every version still sealing; run on the seal-retry interval. */
export async function retrySealing(): Promise<void> {
  const pending = await db.q<{ certificate_id: string; version: number }>(
    "SELECT certificate_id, version FROM certificate_versions WHERE state = 'sealing' AND (lease_until IS NULL OR lease_until < now()) ORDER BY created_at",
  );
  for (const v of pending) {
    if (!(await sealVersion(v.certificate_id, v.version, new Date()))) return;
  }
}

/** The stored PDF of a version. */
export async function versionPdf(serial: string, version: number): Promise<Buffer> {
  return getObject(pdfKey(serial, version));
}

const REASON_MESSAGE = "Give a reason of 1 to 500 characters.";

function reasonOf(body: Record<string, unknown>, v: Validation): string {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 500) v.add("reason", REASON_MESSAGE);
  return reason;
}

/**
 * Reissue and revoke decisions on one certificate are taken one at a time in arrival order (the certificate row is
 * claimed first), each against the state the previous one left.
 */
async function decide(
  planner: SessionUser,
  id: unknown,
  body: Record<string, unknown>,
  to: "reissued" | "revoked",
  apply: (t: Db, view: CertificateView, reason: string) => Promise<void>,
): Promise<string> {
  const known = await certificateRow(db, id);
  if (!known || !canReadEnrolment(planner, known)) throw notFound();
  if (planner.role !== "planner") throw forbidden();
  const v = new Validation(body, ["reason"]);
  const reason = reasonOf(body, v);
  await tx(async (t) => {
    await claimRow(t, "certificates", known.id);
    const view = await certificateView(t, (await certificateRow(t, known.id)) ?? known);
    if (view.row.state !== "sealed") throw conflict("invalid_transition", { from: view.row.state, to });
    if (view.reissuePending) throw conflict("reissue_pending");
    v.done();
    await apply(t, view, reason);
  });
  return known.id;
}

export async function reissueCertificate(planner: SessionUser, id: unknown, body: Record<string, unknown>, origin: string, now: Date): Promise<{ sealed: boolean; certificate: Record<string, unknown> }> {
  let version = 0;
  const certificateId = await decide(planner, id, body, "reissued", async (t, current, reason) => {
    const latest = current.versions.reduce((max, x) => Math.max(max, x.version), 0);
    version = latest + 1;
    await t.q(
      `INSERT INTO certificate_versions (certificate_id, version, state, nurse_name, origin, reason, decided_by, created_at)
       VALUES ($1, $2, 'sealing', (SELECT display_name FROM users WHERE id = $3), $4, $5, $6, $7)`,
      [current.row.id, version, current.row.learner_id, origin, reason, planner.id, now],
    );
  });
  const sealed = await sealVersion(certificateId, version, now);
  return { sealed, certificate: await certificateById(db, certificateId) };
}

export async function revokeCertificate(planner: SessionUser, id: unknown, body: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  const certificateId = await decide(planner, id, body, "revoked", async (t, current, reason) => {
    await t.q("UPDATE certificates SET state = 'revoked' WHERE id = $1", [current.row.id]);
    await t.q("UPDATE certificate_versions SET state = 'revoked' WHERE certificate_id = $1 AND version = $2", [current.row.id, current.current.version]);
    await t.q("INSERT INTO certificate_revocations (certificate_id, reason, decided_by, decided_at) VALUES ($1, $2, $3, $4)", [
      current.row.id,
      reason,
      planner.id,
      now,
    ]);
  });
  return certificateById(db, certificateId);
}

/** The session download: the current version's PDF; a certificate still sealing has none yet. */
export async function currentPdf(view: CertificateView): Promise<{ bytes: Buffer; filename: string }> {
  if (view.row.state === "sealing") throw conflict("pdf_pending");
  return { bytes: await versionPdf(view.row.serial, view.current.version), filename: `${view.row.serial}-v${view.current.version}.pdf` };
}

/** A learner's transcript: every certificate, and the hours of the sealed ones counted once each. */
export async function transcript(t: Db, learner: SessionUser): Promise<Record<string, unknown>> {
  const rows = await t.q<CertificateRow>(`${CERTIFICATE_SELECT} WHERE x.learner_id = $1 ORDER BY x.created_at DESC`, [learner.id]);
  const total = rows.filter((r) => r.state === "sealed").reduce((sum, r) => sum + r.contact_quarters, 0);
  return { certificates: await certificatesJson(t, rows), total_hours: formatHours(total) };
}

/** Planner search: serial, any version's nurse name, or the nurse's current display name, matched literally. */
export async function searchCertificates(t: Db, q: string): Promise<Record<string, unknown>[]> {
  const rows = await t.q<CertificateRow>(
    `${CERTIFICATE_SELECT}
      WHERE $1 = '' OR strpos(lower(x.serial), lower($1)) > 0 OR strpos(lower(u.display_name), lower($1)) > 0
         OR EXISTS (SELECT 1 FROM certificate_versions v WHERE v.certificate_id = x.id AND strpos(lower(v.nurse_name), lower($1)) > 0)
      ORDER BY x.created_at DESC`,
    [q],
  );
  return certificatesJson(t, rows);
}
