import { query, one, withTransaction, type Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { randomToken } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { config } from "../config.js";
import { queueEmail } from "./outbox.js";
import type { SessionMember } from "./sessions.js";

/** Casting packages and their private links. */

export interface PackageRow {
  id: string;
  title: string;
  recipient_name: string;
  recipient_email: string;
  state: string;
  token: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  created_by: string;
}

export const PACKAGE_TTL_DEFAULT = 1209600;

export function packageView(row: PackageRow, talent: Array<{ talentId: string; displayName: string; decision: string }>): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    state: row.state,
    url: `/p/${row.token}`,
    issuedAt: toInstant(row.issued_at),
    expiresAt: toInstant(row.expires_at),
    talent,
  };
}

export async function packageTalent(packageId: string): Promise<Array<{ talentId: string; displayName: string; decision: string; slug: string; state: string }>> {
  return query<{ talentId: string; displayName: string; decision: string; slug: string; state: string }>(
    `SELECT pt.talent_id AS "talentId", t.display_name AS "displayName", pt.decision, t.slug, t.state
     FROM package_talent pt JOIN talent t ON t.id = pt.talent_id
     WHERE pt.package_id = $1 AND t.state = 'active' ORDER BY pt.position`,
    [packageId]
  );
}

export async function createPackage(input: { title: string; recipientName: string; recipientEmail: string; talentIds: string[]; member: SessionMember; ttlSeconds: number }): Promise<PackageRow> {
  if (input.talentIds.length === 0) throw errors.validation({ talentIds: "Choose at least one talent." });
  const invalid = await query<{ id: string; state: string }>(`SELECT id, state FROM talent WHERE id = ANY($1::text[])`, [input.talentIds]);
  if (invalid.length !== input.talentIds.length) throw errors.notFound();
  for (const row of invalid) {
    if (row.state !== "active") throw errors.validation({ talentIds: "Choose only active talent." });
  }
  return withTransaction(async (tx) => {
    const id = `pkg_${randomToken(10)}`;
    const now = new Date();
    const token = randomToken(40);
    await tx.query(
      `INSERT INTO packages (id, title, recipient_name, recipient_email, state, token, issued_at, expires_at, created_by)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8)`,
      [id, input.title, input.recipientName, input.recipientEmail, token, now, new Date(now.getTime() + input.ttlSeconds * 1000), input.member.id]
    );
    let position = 0;
    for (const talentId of input.talentIds) {
      await tx.query(`INSERT INTO package_talent (package_id, talent_id, position, decision) VALUES ($1, $2, $3, 'undecided')`, [id, talentId, position++]);
    }
    const row = await loadPackage(tx, id);
    await queuePackageEmail(tx, row);
    return row;
  });
}

async function queuePackageEmail(tx: Tx, row: PackageRow): Promise<void> {
  void tx;
  const link = `${config.baseUrl}/p/${row.token}`;
  await queueEmail({
    to: row.recipient_email,
    subject: `Casting package: ${row.title}`,
    body: [`Hello ${row.recipient_name},`, ``, `Your casting package is ready:`, ``, link, ``, `Vesper & Rowe Talent`].join("\r\n"),
  });
}

async function loadPackage(tx: Tx, id: string): Promise<PackageRow> {
  const row = await tx.one<PackageRow>(`SELECT * FROM packages WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  return row;
}

export async function getPackage(id: string): Promise<PackageRow> {
  const row = await one<PackageRow>(`SELECT * FROM packages WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  return row;
}

export async function revokePackage(id: string): Promise<PackageRow> {
  return withTransaction(async (tx) => {
    const existing = await loadPackage(tx, id);
    if (existing.state === "revoked") throw errors.conflict("already_revoked");
    await tx.query(`UPDATE packages SET state = 'revoked', revoked_at = now() WHERE id = $1`, [id]);
    return await loadPackage(tx, id);
  });
}

export async function regeneratePackage(id: string, ttlSeconds: number): Promise<PackageRow> {
  return withTransaction(async (tx) => {
    await loadPackage(tx, id);
    const token = randomToken(40);
    const now = new Date();
    await tx.query(
      `UPDATE packages SET state = 'active', token = $2, issued_at = $3, expires_at = $4, revoked_at = NULL,
        replaced_tokens = array_append(replaced_tokens, (SELECT token FROM packages WHERE id = $1))
       WHERE id = $1`,
      [id, token, now, new Date(now.getTime() + ttlSeconds * 1000)]
    );
    const fresh = await loadPackage(tx, id);
    await queuePackageEmail(tx, fresh);
    return fresh;
  });
}

export interface LinkState {
  row: PackageRow | null;
  dead: "link_expired" | "link_revoked" | "link_replaced" | null;
}

/** Resolves a package link token to its live state, or the reason it is dead. */
export async function linkState(token: string): Promise<LinkState> {
  const row = await one<PackageRow>(`SELECT * FROM packages WHERE token = $1`, [token]);
  if (!row) {
    // A token replaced by a regeneration stays dead forever.
    const replaced = await one<{ id: string }>(`SELECT id FROM packages WHERE $1 = ANY(replaced_tokens)`, [token]);
    return { row: null, dead: replaced ? "link_replaced" : null };
  }
  if (row.state === "revoked") return { row: null, dead: "link_revoked" };
  if (row.expires_at.getTime() <= Date.now()) return { row: null, dead: "link_expired" };
  return { row, dead: null };
}

/** The package view shown through a private link: public fields only. */
export async function packageLinkView(row: PackageRow): Promise<Record<string, unknown>> {
  const talent = await packageTalent(row.id);
  const shortlisted = talent.filter((t) => t.decision === "shortlisted").length;
  const cards = [];
  for (const t of talent) {
    const photos = await query<{ id: string; width: number; height: number }>(`SELECT id, width, height FROM photos WHERE talent_id = $1 ORDER BY position`, [t.talentId]);
    const detail = await one<{ office: string; board: string; height_cm: number | null; chest_cm: number | null; waist_cm: number | null; hips_cm: number | null; instagram: number; tiktok: number; youtube: number }>(
      `SELECT office, board, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube FROM talent WHERE id = $1`,
      [t.talentId]
    );
    if (!detail) continue;
    cards.push({
      slug: t.slug,
      displayName: t.displayName,
      office: detail.office,
      board: detail.board,
      measurements: { heightCm: detail.height_cm, chestCm: detail.chest_cm, waistCm: detail.waist_cm, hipsCm: detail.hips_cm },
      reach: { instagram: detail.instagram, tiktok: detail.tiktok, youtube: detail.youtube, total: detail.instagram + detail.tiktok + detail.youtube },
      coverPhotoUrl: photos[0] ? `/api/photos/${photos[0].id}` : null,
      portfolio: photos.map((p) => ({ photoId: p.id, url: `/api/photos/${p.id}`, width: p.width, height: p.height })),
      decision: t.decision,
    });
  }
  return {
    title: row.title,
    expiresAt: toInstant(row.expires_at),
    shortlistedCount: shortlisted,
    talent: cards,
  };
}

export async function setDecision(token: string, slug: string, decision: string): Promise<{ slug: string; decision: string; shortlistedCount: number }> {
  return withTransaction(async (tx) => {
    const row = await tx.one<PackageRow>(`SELECT * FROM packages WHERE token = $1`, [token]);
    if (!row) {
      const replaced = await tx.one<{ id: string }>(`SELECT id FROM packages WHERE $1 = ANY(replaced_tokens)`, [token]);
      if (replaced) throw errors.gone("link_replaced");
      throw errors.notFound();
    }
    if (row.state === "revoked") throw errors.gone("link_revoked");
    if (row.expires_at.getTime() <= Date.now()) throw errors.gone("link_expired");
    const talent = await tx.one<{ talentId: string; state: string }>(
      `SELECT pt.talent_id AS "talentId", t.state FROM package_talent pt JOIN talent t ON t.id = pt.talent_id WHERE pt.package_id = $1 AND t.slug = $2`,
      [row.id, slug]
    );
    if (!talent || talent.state !== "active") throw errors.notFound();
    await tx.query(`UPDATE package_talent SET decision = $3 WHERE package_id = $1 AND talent_id = $2`, [row.id, talent.talentId, decision]);
    const count = await tx.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM package_talent pt JOIN talent t ON t.id = pt.talent_id WHERE pt.package_id = $1 AND pt.decision = 'shortlisted' AND t.state = 'active'`,
      [row.id]
    );
    return { slug, decision, shortlistedCount: count?.count || 0 };
  });
}

export async function listPackages(): Promise<Array<{ row: PackageRow; talent: Array<{ talentId: string; displayName: string; decision: string; state: string }>; shortlistedCount: number }>> {
  const rows = await query<PackageRow>(`SELECT * FROM packages ORDER BY issued_at DESC`);
  const out = [];
  for (const row of rows) {
    const talent = await query<{ talentId: string; displayName: string; decision: string; state: string }>(
      `SELECT pt.talent_id AS "talentId", t.display_name AS "displayName", pt.decision, t.state FROM package_talent pt JOIN talent t ON t.id = pt.talent_id WHERE pt.package_id = $1 ORDER BY pt.position`,
      [row.id]
    );
    out.push({ row, talent, shortlistedCount: talent.filter((t) => t.decision === "shortlisted" && t.state === "active").length });
  }
  return out;
}
