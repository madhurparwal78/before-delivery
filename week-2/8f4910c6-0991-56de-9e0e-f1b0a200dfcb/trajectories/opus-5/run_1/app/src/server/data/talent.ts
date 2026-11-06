import { query, queryOne, type Tx } from '../db.js';
import { newId, newToken, slugify } from '../ids.js';
import type {
  Board,
  OfficeId,
  PortfolioPhoto,
  PublicCard,
  PublicProfile,
  TalentRecord,
  TalentState,
} from '../../shared/types.js';

export type TalentRow = {
  id: string;
  slug: string;
  display_name: string;
  state: TalentState;
  office_id: OfficeId;
  board: Board;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  home_address: string | null;
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
  version: number;
  portfolio_version: number;
  saved_by: string | null;
  saved_at: Date | null;
  portfolio_saved_by: string | null;
  portfolio_saved_at: Date | null;
};

export type PhotoRow = {
  id: string;
  talent_id: string;
  position: number;
  object_key: string;
  width: number;
  height: number;
  bytes: number;
};

export const ERASED_NAME = 'Erased talent';

export async function findTalentById(id: string): Promise<TalentRow | null> {
  return queryOne<TalentRow>('SELECT * FROM talent WHERE id = $1', [id]);
}

export async function findTalentBySlug(slug: string): Promise<TalentRow | null> {
  return queryOne<TalentRow>('SELECT * FROM talent WHERE slug = $1', [slug]);
}

export async function listTalent(filter: { office?: OfficeId; state?: TalentState } = {}): Promise<TalentRow[]> {
  return query<TalentRow>(
    `SELECT * FROM talent
     WHERE ($1::text IS NULL OR office_id = $1)
       AND ($2::text IS NULL OR state = $2)
     ORDER BY display_name`,
    [filter.office ?? null, filter.state ?? null],
  );
}

export async function photosFor(talentIds: string[]): Promise<Map<string, PhotoRow[]>> {
  if (talentIds.length === 0) return new Map();
  const rows = await query<PhotoRow>(
    'SELECT * FROM photos WHERE talent_id = ANY($1::text[]) ORDER BY talent_id, position',
    [talentIds],
  );
  const map = new Map<string, PhotoRow[]>();
  for (const row of rows) {
    const list = map.get(row.talent_id) ?? [];
    list.push(row);
    map.set(row.talent_id, list);
  }
  return map;
}

export async function photosOf(talentId: string): Promise<PhotoRow[]> {
  return query<PhotoRow>('SELECT * FROM photos WHERE talent_id = $1 ORDER BY position', [talentId]);
}

export function photoUrl(photoId: string): string {
  return `/api/photos/${photoId}`;
}

function portfolioView(photos: PhotoRow[]): PortfolioPhoto[] {
  return photos.map((photo) => ({
    photoId: photo.id,
    url: photoUrl(photo.id),
    width: photo.width,
    height: photo.height,
  }));
}

function reachOf(row: TalentRow): { instagram: number; tiktok: number; youtube: number; total: number } {
  return {
    instagram: row.instagram,
    tiktok: row.tiktok,
    youtube: row.youtube,
    total: row.instagram + row.tiktok + row.youtube,
  };
}

/** Exactly the published public fields; never notes, rates or contact details. */
export function cardView(row: TalentRow, photos: PhotoRow[]): PublicCard {
  return {
    slug: row.slug,
    displayName: row.display_name,
    office: row.office_id,
    board: row.board,
    measurements: {
      heightCm: row.height_cm,
      chestCm: row.chest_cm,
      waistCm: row.waist_cm,
      hipsCm: row.hips_cm,
    },
    reach: reachOf(row),
    coverPhotoUrl: photos.length > 0 ? photoUrl(photos[0].id) : null,
  };
}

export function profileView(row: TalentRow, photos: PhotoRow[]): PublicProfile {
  return { ...cardView(row, photos), portfolio: portfolioView(photos) };
}

export function talentView(row: TalentRow, photos: PhotoRow[], withOfficeNote: boolean): TalentRecord {
  const record: TalentRecord = {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    state: row.state,
    office: row.office_id,
    board: row.board,
    dateOfBirth: row.date_of_birth,
    email: row.email,
    phone: row.phone,
    homeAddress: row.home_address,
    guardian: row.guardian_name || row.guardian_email || row.guardian_phone
      ? { name: row.guardian_name, email: row.guardian_email, phone: row.guardian_phone }
      : null,
    measurements: {
      heightCm: row.height_cm,
      chestCm: row.chest_cm,
      waistCm: row.waist_cm,
      hipsCm: row.hips_cm,
    },
    reach: reachOf(row),
    portfolio: portfolioView(photos),
    version: row.version,
    portfolioVersion: row.portfolio_version,
  };
  if (withOfficeNote) record.officeNote = row.office_note;
  return record;
}

async function uniqueSlug(displayName: string): Promise<string> {
  const base = slugify(displayName) || 'talent';
  const taken = await query<{ slug: string }>('SELECT slug FROM talent WHERE slug = $1 OR slug LIKE $2', [
    base,
    `${base}-%`,
  ]);
  const existing = new Set(taken.map((row) => row.slug));
  if (!existing.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export type NewTalent = {
  displayName: string;
  office: OfficeId;
  board: Board;
  email?: string | null;
  dateOfBirth?: string | null;
  phone?: string | null;
  guardianName?: string | null;
  guardianEmail?: string | null;
  guardianPhone?: string | null;
  heightCm?: number | null;
  chestCm?: number | null;
  waistCm?: number | null;
  hipsCm?: number | null;
  instagram?: number;
  tiktok?: number;
  youtube?: number;
  officeNote?: string | null;
};

export async function insertTalent(input: NewTalent, tx?: Tx): Promise<TalentRow> {
  const run = tx ? tx.query.bind(tx) : query;
  const slug = await uniqueSlug(input.displayName);
  const rows = await run<TalentRow>(
    `INSERT INTO talent (
       id, slug, display_name, state, office_id, board, date_of_birth, email, phone,
       guardian_name, guardian_email, guardian_phone,
       height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube, office_note, feed_token
     ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING *`,
    [
      newId('tal'),
      slug,
      input.displayName,
      input.office,
      input.board,
      input.dateOfBirth ?? null,
      input.email ?? null,
      input.phone ?? null,
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
      newToken(),
    ],
  );
  return rows[0];
}

export async function bumpTalentVersion(id: string, savedBy: string, nowMs: number): Promise<TalentRow> {
  const rows = await query<TalentRow>(
    'UPDATE talent SET version = version + 1, saved_by = $2, saved_at = $3 WHERE id = $1 RETURNING *',
    [id, savedBy, new Date(nowMs)],
  );
  return rows[0];
}
