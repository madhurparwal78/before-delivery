/** The catalogue, editions, club roster, bank holidays and the decided-claims counts. */

import type { Edition } from '../domain/editions';
import type { CatalogueNames } from '../domain/model-match';
import type { LondonDate } from '../domain/time';
import { query, queryOne, type Transaction } from './pool';

export type PartStatus = 'active' | 'withdrawn';
export type ModelAxis = 'x' | 'y' | 'iso';

export interface CatalogueModel {
  slug: string;
  name: string;
  axis: ModelAxis | null;
  partCount: number;
}

export interface CataloguePart {
  modelSlug: string;
  bookletNumber: number;
  partNumber: string;
  name: string;
  priceMinor: number;
  weightG: number;
  longestSideMm: number;
  status: PartStatus;
  binCount: number;
}

interface ModelRow {
  slug: string;
  name: string;
  axis: ModelAxis | null;
  part_count: string;
}

interface PartRow {
  model_slug: string;
  booklet_number: number;
  part_number: string;
  name: string;
  price_minor: number;
  weight_g: number;
  longest_side_mm: number;
  status: PartStatus;
  bin_count: number;
}

function toPart(row: PartRow): CataloguePart {
  return {
    modelSlug: row.model_slug,
    bookletNumber: row.booklet_number,
    partNumber: row.part_number,
    name: row.name,
    priceMinor: row.price_minor,
    weightG: row.weight_g,
    longestSideMm: row.longest_side_mm,
    status: row.status,
    binCount: row.bin_count,
  };
}

const PART_COLUMNS = `model_slug, booklet_number, part_number, name, price_minor, weight_g,
                      longest_side_mm, status, bin_count`;

export async function listModels(): Promise<CatalogueModel[]> {
  const rows = await query<ModelRow>(
    `SELECT m.slug, m.name, m.axis,
            (SELECT count(*) FROM parts p WHERE p.model_slug = m.slug)::text AS part_count
       FROM models m
      ORDER BY m.sort_order`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    axis: row.axis,
    partCount: Number(row.part_count),
  }));
}

export async function findModel(slug: string): Promise<CatalogueModel | null> {
  const row = await queryOne<ModelRow>(
    `SELECT m.slug, m.name, m.axis,
            (SELECT count(*) FROM parts p WHERE p.model_slug = m.slug)::text AS part_count
       FROM models m WHERE m.slug = $1`,
    [slug],
  );
  return row === null ? null : { slug: row.slug, name: row.name, axis: row.axis, partCount: Number(row.part_count) };
}

export async function listParts(modelSlug: string): Promise<CataloguePart[]> {
  const rows = await query<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE model_slug = $1 ORDER BY booklet_number`,
    [modelSlug],
  );
  return rows.map(toPart);
}

export async function findPart(modelSlug: string, bookletNumber: number): Promise<CataloguePart | null> {
  const row = await queryOne<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE model_slug = $1 AND booklet_number = $2`,
    [modelSlug, bookletNumber],
  );
  return row === null ? null : toPart(row);
}

/** Ordered by model slug, then booklet number as a number, then part number as a tiebreak. */
export async function pageParts(
  modelSlug: string | null,
  limit: number,
  cursor: { slug: string; booklet: number; partNumber: string } | null,
): Promise<CataloguePart[]> {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (modelSlug !== null) {
    values.push(modelSlug);
    conditions.push(`model_slug = $${values.length}`);
  }
  if (cursor !== null) {
    values.push(cursor.slug, cursor.booklet, cursor.partNumber);
    const base = values.length - 2;
    conditions.push(`(model_slug, booklet_number, part_number) > ($${base}, $${base + 1}, $${base + 2})`);
  }
  values.push(limit);
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const rows = await query<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts ${where}
      ORDER BY model_slug, booklet_number, part_number
      LIMIT $${values.length}`,
    values,
  );
  return rows.map(toPart);
}

export async function modelNamesForMatching(): Promise<CatalogueNames[]> {
  const rows = await query<{ slug: string; name: string; retired: string[] | null }>(
    `SELECT m.slug, m.name,
            array_remove(array_agg(r.retired_name), NULL) AS retired
       FROM models m
       LEFT JOIN model_retired_names r ON r.slug = m.slug
      GROUP BY m.slug, m.name
      ORDER BY m.sort_order`,
  );
  return rows.map((row) => ({ slug: row.slug, name: row.name, retiredNames: row.retired ?? [] }));
}

interface EditionRow {
  code: string;
  title: string;
  starts_on: string;
  standard_months: number;
  club_months: number;
  owner_contribution_percent: number;
}

function toEdition(row: EditionRow): Edition {
  return {
    code: row.code,
    title: row.title,
    startsOn: row.starts_on,
    standardMonths: row.standard_months,
    clubMonths: row.club_months,
    ownerContributionPercent: row.owner_contribution_percent,
  };
}

const EDITION_COLUMNS = 'code, title, starts_on, standard_months, club_months, owner_contribution_percent';

export async function listEditions(): Promise<Edition[]> {
  const rows = await query<EditionRow>(`SELECT ${EDITION_COLUMNS} FROM editions ORDER BY starts_on`);
  return rows.map(toEdition);
}

export async function listEditionsIn(tx: Transaction): Promise<Edition[]> {
  const rows = await tx.query<EditionRow>(`SELECT ${EDITION_COLUMNS} FROM editions ORDER BY starts_on`);
  return rows.map(toEdition);
}

export async function insertEdition(edition: Edition): Promise<void> {
  await query(
    `INSERT INTO editions (code, title, starts_on, standard_months, club_months, owner_contribution_percent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      edition.code,
      edition.title,
      edition.startsOn,
      edition.standardMonths,
      edition.clubMonths,
      edition.ownerContributionPercent,
    ],
  );
}

export async function editionCodeTaken(code: string): Promise<boolean> {
  return (await queryOne<{ code: string }>('SELECT code FROM editions WHERE code = $1', [code])) !== null;
}

export async function editionDateTaken(startsOn: LondonDate): Promise<boolean> {
  return (await queryOne<{ code: string }>('SELECT code FROM editions WHERE starts_on = $1', [startsOn])) !== null;
}

export async function bankHolidays(): Promise<Set<LondonDate>> {
  const rows = await query<{ holiday: string }>('SELECT holiday FROM bank_holidays');
  return new Set(rows.map((row) => row.holiday));
}

export async function bankHolidaysIn(tx: Transaction): Promise<Set<LondonDate>> {
  const rows = await tx.query<{ holiday: string }>('SELECT holiday FROM bank_holidays');
  return new Set(rows.map((row) => row.holiday));
}

/** A club member joined strictly before the purchase date. */
export async function isClubMember(tx: Transaction, email: string, purchaseDate: LondonDate): Promise<boolean> {
  const row = await tx.queryOne<{ email: string }>(
    'SELECT email FROM club_roster WHERE lower(email) = lower($1) AND joined_on < $2',
    [email, purchaseDate],
  );
  return row !== null;
}

export async function deleteClubMember(tx: Transaction, email: string): Promise<void> {
  await tx.query('DELETE FROM club_roster WHERE lower(email) = lower($1)', [email]);
}

export interface DecidedCounts {
  decidedClaims: number;
  decidedInside: number;
  decidedOutside: number;
}

export async function decidedCounts(): Promise<DecidedCounts> {
  const rows = await query<{ name: string; value: string }>('SELECT name, value FROM desk_counters');
  const read = (name: string): number => Number(rows.find((row) => row.name === name)?.value ?? '0');
  return {
    decidedClaims: read('decided_claims'),
    decidedInside: read('decided_inside'),
    decidedOutside: read('decided_outside'),
  };
}

/** Each identification adds one. Nothing ever lowers these counts, erasure included. */
export async function countDecision(tx: Transaction, inside: boolean): Promise<void> {
  const second = inside ? 'decided_inside' : 'decided_outside';
  await tx.query(`UPDATE desk_counters SET value = value + 1 WHERE name IN ('decided_claims', $1)`, [second]);
}

/** A quote takes its units only when the bin holds at least the quantity. */
export async function takeFromBin(tx: Transaction, modelSlug: string, bookletNumber: number, quantity: number): Promise<boolean> {
  const rows = await tx.query<{ bin_count: number }>(
    `UPDATE parts SET bin_count = bin_count - $3
      WHERE model_slug = $1 AND booklet_number = $2 AND bin_count >= $3
      RETURNING bin_count`,
    [modelSlug, bookletNumber, quantity],
  );
  return rows.length === 1;
}

export async function returnToBin(tx: Transaction, modelSlug: string, bookletNumber: number, quantity: number): Promise<void> {
  await tx.query('UPDATE parts SET bin_count = bin_count + $3 WHERE model_slug = $1 AND booklet_number = $2', [
    modelSlug,
    bookletNumber,
    quantity,
  ]);
}

export async function findPartIn(tx: Transaction, modelSlug: string, bookletNumber: number): Promise<CataloguePart | null> {
  const row = await tx.queryOne<PartRow>(
    `SELECT ${PART_COLUMNS} FROM parts WHERE model_slug = $1 AND booklet_number = $2`,
    [modelSlug, bookletNumber],
  );
  return row === null ? null : toPart(row);
}

export async function upsertImportedPart(
  tx: Transaction,
  part: Omit<CataloguePart, 'binCount'>,
): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await findPartIn(tx, part.modelSlug, part.bookletNumber);
  if (existing === null) {
    // A part the supplier file introduces starts with an empty bin.
    await tx.query(
      `INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g,
                          longest_side_mm, status, bin_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
      [
        part.modelSlug,
        part.bookletNumber,
        part.partNumber,
        part.name,
        part.priceMinor,
        part.weightG,
        part.longestSideMm,
        part.status,
      ],
    );
    return 'created';
  }

  const same =
    existing.partNumber === part.partNumber &&
    existing.name === part.name &&
    existing.priceMinor === part.priceMinor &&
    existing.weightG === part.weightG &&
    existing.longestSideMm === part.longestSideMm &&
    existing.status === part.status;
  if (same) return 'unchanged';

  // An import never touches bin counts, rulings or quotes.
  await tx.query(
    `UPDATE parts SET part_number = $3, name = $4, price_minor = $5, weight_g = $6,
                      longest_side_mm = $7, status = $8
      WHERE model_slug = $1 AND booklet_number = $2`,
    [
      part.modelSlug,
      part.bookletNumber,
      part.partNumber,
      part.name,
      part.priceMinor,
      part.weightG,
      part.longestSideMm,
      part.status,
    ],
  );
  return 'updated';
}
