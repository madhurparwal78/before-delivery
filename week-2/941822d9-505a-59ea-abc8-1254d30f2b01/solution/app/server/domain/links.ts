import { randomBytes, randomUUID } from "node:crypto";
import { claimRow, db, one, tx } from "../db.js";
import { config } from "../config.js";
import { conflict, forbidden, notFound, Validation } from "../http/errors.js";
import { formatHours } from "./amounts.js";
import { certificateRow, certificateView, readableCertificate, versionPdf, type CertificateView } from "./certificates.js";
import { isId } from "./courses.js";
import { provider } from "./provider.js";
import type { SessionUser } from "./users.js";

// Verification links: unguessable, one active link per certificate, revocable, expiring at an exact instant.

interface LinkRow {
  id: string;
  certificate_id: string;
  token: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

const LINK_COLUMNS = "id, certificate_id, token, created_at, expires_at, revoked_at";

/** A link revoked before its expiry instant is revoked; otherwise it is expired from that instant on. */
function linkState(link: LinkRow, at: Date): "active" | "revoked" | "expired" {
  if (link.revoked_at !== null && link.revoked_at.getTime() < link.expires_at.getTime()) return "revoked";
  return at.getTime() >= link.expires_at.getTime() ? "expired" : "active";
}

const linkJson = (link: LinkRow, at: Date): Record<string, unknown> => ({
  id: link.id,
  url: `/verify/${link.token}`,
  state: linkState(link, at),
  created_at: link.created_at.toISOString(),
  expires_at: link.expires_at.toISOString(),
});

async function ownCertificate(learner: SessionUser, id: unknown): Promise<CertificateView> {
  const view = await readableCertificate(db, learner, id);
  if (view.row.learner_id !== learner.id) throw forbidden();
  return view;
}

/** Creates a link, replacing (revoking) the active one. Tokens carry 256 random bits. */
export async function createLink(learner: SessionUser, id: unknown, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const view = await ownCertificate(learner, id);
  if (view.row.state !== "sealed") throw conflict("certificate_not_sealed");
  new Validation(body, []).done();
  const link: LinkRow = { id: randomUUID(), certificate_id: view.row.id, token: randomBytes(32).toString("base64url"), created_at: at, expires_at: new Date(at.getTime() + config.clock.shareLinkTtlMs), revoked_at: null };
  await tx(async (t) => {
    await claimRow(t, "certificates", view.row.id);
    const current = await certificateRow(t, view.row.id);
    if (current?.state !== "sealed") throw conflict("certificate_not_sealed");
    await t.q("UPDATE verification_links SET revoked_at = $2 WHERE certificate_id = $1 AND revoked_at IS NULL AND expires_at > $2", [view.row.id, at]);
    await t.q("INSERT INTO verification_links (id, certificate_id, token, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)", [
      link.id,
      link.certificate_id,
      link.token,
      link.created_at,
      link.expires_at,
    ]);
  });
  return linkJson(link, at);
}

export async function listLinks(learner: SessionUser, id: unknown, at: Date): Promise<Record<string, unknown>[]> {
  const view = await ownCertificate(learner, id);
  const rows = await db.q<LinkRow>(
    `SELECT ${LINK_COLUMNS} FROM verification_links WHERE certificate_id = $1 ORDER BY created_at, id`,
    [view.row.id],
  );
  return rows.map((row) => linkJson(row, at));
}

export async function revokeLink(learner: SessionUser, id: unknown, linkId: unknown, body: Record<string, unknown>, at: Date): Promise<void> {
  const view = await ownCertificate(learner, id);
  const link = isId(linkId)
    ? await one<LinkRow>(db, `SELECT ${LINK_COLUMNS} FROM verification_links WHERE id = $1 AND certificate_id = $2`, [linkId, view.row.id])
    : undefined;
  if (!link) throw notFound();
  new Validation(body, []).done();
  if (linkState(link, at) === "active") await db.q("UPDATE verification_links SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [link.id, at]);
}

/** The certificate an active link opens, or 404 for an unknown, revoked, replaced or expired link. */
async function linkedCertificate(token: string, at: Date): Promise<CertificateView> {
  const link = await one<LinkRow>(db, `SELECT ${LINK_COLUMNS} FROM verification_links WHERE token = $1`, [token]);
  if (!link || linkState(link, at) !== "active") throw notFound();
  const row = await certificateRow(db, link.certificate_id);
  if (!row) throw notFound();
  return certificateView(db, row);
}

/** The public summary: the private-field allow-list and nothing else. */
export async function verifiedSummary(token: string, at: Date): Promise<Record<string, unknown>> {
  const view = await linkedCertificate(token, at);
  return {
    serial: view.row.serial,
    nurse_name: view.current.nurse_name,
    course_title: view.row.course_title,
    contact_hours: formatHours(view.row.contact_quarters),
    issued_on: view.row.issued_on,
    state: view.row.state,
    provider: provider.name,
    accreditation_statement: provider.accreditationStatement,
  };
}

/** The current version's PDF through an active link; a revoked certificate's PDF is not served. */
export async function verifiedPdf(token: string, at: Date): Promise<{ bytes: Buffer; filename: string }> {
  const view = await linkedCertificate(token, at);
  if (view.row.state !== "sealed") throw notFound();
  return { bytes: await versionPdf(view.row.serial, view.current.version), filename: `${view.row.serial}.pdf` };
}
