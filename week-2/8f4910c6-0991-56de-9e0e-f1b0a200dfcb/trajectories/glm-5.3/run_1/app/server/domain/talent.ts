import { query, one, withTransaction, type Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { BOARDS, OFFICES, type Board, type Office, randomToken } from "../../shared/domain.js";
import { shortId } from "../passwords.js";

export interface TalentRow {
  id: string;
  slug: string;
  display_name: string;
  state: string;
  office: Office;
  board: Board;
  email: string | null;
  phone: string | null;
  home_address: string | null;
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
  height_cm: number | null;
  chest_cm: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  instagram: number;
  tiktok: number;
  youtube: number;
  office_note: string | null;
  feed_token: string | null;
  portfolio_version: number;
  version: number;
}

export type TalentRecord = TalentRow & { portfolio: Array<{ photoId: string; width: number; height: number; position: number }> };

/** Slug from a display name: lower case, accents removed, runs of others to one hyphen. */
export function slugify(name: string): string {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "talent";
}

export async function uniqueSlug(base: string): Promise<string> {
  const existing = await query<{ slug: string }>(`SELECT slug FROM talent WHERE lower(slug) = lower($1) AND state <> 'erased'`, [base]);
  if (existing.length === 0) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    const rows = await query<{ slug: string }>(`SELECT slug FROM talent WHERE lower(slug) = lower($1) AND state <> 'erased'`, [candidate]);
    if (rows.length === 0) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function loadTalent(id: string): Promise<TalentRow> {
  const row = await one<TalentRow>(`SELECT * FROM talent WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  return row;
}

export async function loadTalentBySlug(slug: string, includeInactive = false): Promise<TalentRow | null> {
  const row = await one<TalentRow>(`SELECT * FROM talent WHERE lower(slug) = lower($1) ORDER BY (state = 'active') DESC LIMIT 1`, [slug]);
  if (!row) return null;
  if (!includeInactive && row.state !== "active") return null;
  return row;
}

export async function talentPortfolio(talentId: string): Promise<Array<{ photoId: string; width: number; height: number; position: number }>> {
  const rows = await query<{ id: string; width: number; height: number; position: number }>(
    `SELECT id, width, height, position FROM photos WHERE talent_id = $1 ORDER BY position`,
    [talentId]
  );
  return rows.map((r) => ({ photoId: r.id, width: r.width, height: r.height, position: r.position }));
}

export interface TalentView {
  id: string;
  slug: string;
  displayName: string;
  state: string;
  office: Office;
  board: Board;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  homeAddress: string | null;
  guardian: { name: string; email: string; phone: string } | null;
  measurements: { heightCm: number | null; chestCm: number | null; waistCm: number | null; hipsCm: number | null };
  reach: { instagram: number; tiktok: number; youtube: number; total: number };
  officeNote: string | null;
  portfolio: Array<{ photoId: string; url: string; width: number; height: number }>;
  version: number;
  portfolioVersion: number;
}

export function talentView(row: TalentRow, portfolio: Array<{ photoId: string; width: number; height: number }>, includePrivate: boolean): TalentView {
  const guardian = row.guardian_name && row.guardian_email
    ? { name: row.guardian_name, email: row.guardian_email, phone: row.guardian_phone || "" }
    : null;
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    state: row.state,
    office: row.office,
    board: row.board,
    dateOfBirth: includePrivate ? isoDate(row.date_of_birth) : null,
    email: includePrivate ? row.email : null,
    phone: includePrivate ? row.phone : null,
    homeAddress: includePrivate ? row.home_address : null,
    guardian: includePrivate ? guardian : null,
    measurements: {
      heightCm: row.height_cm,
      chestCm: row.chest_cm,
      waistCm: row.waist_cm,
      hipsCm: row.hips_cm,
    },
    reach: { instagram: row.instagram, tiktok: row.tiktok, youtube: row.youtube, total: row.instagram + row.tiktok + row.youtube },
    officeNote: includePrivate ? row.office_note : null,
    portfolio: portfolio.map((p) => ({ photoId: p.photoId, url: `/api/photos/${p.photoId}`, width: p.width, height: p.height })),
    version: row.version,
    portfolioVersion: row.portfolio_version,
  };
}

function isoDate(d: Date | string | null): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function isBoard(value: string): value is Board {
  return (BOARDS as readonly string[]).includes(value);
}

export function isOffice(value: string): value is Office {
  return (OFFICES as readonly string[]).includes(value);
}

/** Measurement input parsing: cm or ft/in. */
export function parseMeasurement(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value > 0 && value < 400 ? value : null;
  if (typeof value === "string") {
    return parseMeasurementText(value);
  }
  return null;
}

export function parseMeasurementText(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "") return null;
  const m = /^(\d+(?:\.\d+)?)\s*m$/.exec(t);
  if (m) return roundHalfUp(Number(m[1]) * 100);
  const cm = /^(\d+(?:\.\d+)?)\s*cm$/.exec(t);
  if (cm) return roundHalfUp(Number(cm[1]));
  const ftIn = /^(\d+)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?$/.exec(t);
  if (ftIn) {
    const total = Number(ftIn[1]) * 12 + Number(ftIn[2] || 0);
    return roundHalfUp(total * 2.54);
  }
  const inchesOnly = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/.exec(t);
  if (inchesOnly) return roundHalfUp(Number(inchesOnly[1]) * 2.54);
  const bare = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (bare) return roundHalfUp(Number(bare[1]));
  return null;
}

export function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) + 1e-9);
}

export async function createTalent(tx: Tx, input: { displayName: string; email: string | null; office: Office; board: Board; heightCm?: number | null; chestCm?: number | null; waistCm?: number | null; hipsCm?: number | null; instagram?: number; tiktok?: number; youtube?: number; dateOfBirth?: string | null; phone?: string | null; homeAddress?: string | null; guardianName?: string | null; guardianEmail?: string | null; guardianPhone?: string | null; officeNote?: string | null }): Promise<TalentRow> {
  const base = slugify(input.displayName);
  const existing = await tx.query<{ slug: string }>(`SELECT slug FROM talent WHERE lower(slug) = lower($1) AND state <> 'erased'`, [base]);
  let slug = base;
  let n = 2;
  while (existing.some((r) => r.slug.toLowerCase() === slug.toLowerCase())) {
    slug = `${base}-${n}`;
    n += 1;
  }
  const id = shortId("tal");
  const emailTaken = input.email
    ? await tx.one<{ id: string }>(`SELECT id FROM talent WHERE lower(email) = lower($1) AND state <> 'erased'`, [input.email])
    : null;
  if (emailTaken) throw errors.validation({ email: "Another talent already has that email." });
  const row = await tx.one<TalentRow>(
    `INSERT INTO talent (id, slug, display_name, state, office, board, email, phone, home_address, date_of_birth, guardian_name, guardian_email, guardian_phone, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube, office_note, feed_token)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING *`,
    [
      id,
      slug,
      input.displayName,
      input.office,
      input.board,
      input.email,
      input.phone ?? null,
      input.homeAddress ?? null,
      input.dateOfBirth ?? null,
      input.guardianName ?? null,
      input.guardianEmail ?? null,
      input.guardianPhone ?? null,
      input.heightCm ?? null,
      input.chestCm ?? null,
      input.waistCm ?? null,
      input.hipsCm ?? null,
      input.instagram ?? 0,
      input.tiktok ?? 0,
      input.youtube ?? 0,
      input.officeNote ?? null,
      randomToken(40),
    ]
  );
  if (!row) throw new Error("insert failed");
  return row;
}

export async function nextTalentVersion(): Promise<string> {
  return shortId("v");
}

export function transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransaction(fn);
}
