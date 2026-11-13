import type { PersistedReferenceState, ReferenceJson } from '../../shared/types.js';
import { sizeText } from '../domain/sizes.js';
import type { SearchDocument } from '../services/search.js';
import type { Queryable } from './pool.js';
import { pool } from './pool.js';

export interface ReferenceRow {
  id: string;
  state: PersistedReferenceState;
  version: number;
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string | null;
  colour_family: string;
  source_url: string | null;
  source_note: string | null;
  notes: string | null;
  width_tenths: number;
  height_tenths: number;
  depth_tenths: number;
  swatch: string;
  swatch_source: 'computed' | 'eyedropper';
  captured_at: string;
  trashed_at: string | null;
  purge_at: string | null;
  purge_at_epoch: string | null;
  photo_content_type: 'image/jpeg' | 'image/png';
  photo_bytes: number;
  photo_sha256: string;
  photo_width: number;
  photo_height: number;
  original_key: string;
  display_key: string;
}

const UTC_ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

export const REFERENCE_COLUMNS = `
  id, state, version, title, maker, year, materials, finish, colour_family,
  source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
  swatch, swatch_source,
  to_char(captured_at at time zone 'UTC', ${UTC_ISO}) as captured_at,
  to_char(trashed_at at time zone 'UTC', ${UTC_ISO}) as trashed_at,
  to_char(purge_at at time zone 'UTC', ${UTC_ISO}) as purge_at,
  extract(epoch from purge_at)::text as purge_at_epoch,
  photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height,
  original_key, display_key
`;

export function toReferenceJson(row: ReferenceRow): ReferenceJson {
  const size = {
    width: row.width_tenths,
    height: row.height_tenths,
    depth: row.depth_tenths,
  };
  return {
    id: row.id,
    state: row.state === 'trashed' ? 'trashed' : 'stored',
    version: row.version,
    title: row.title,
    maker: row.maker,
    year: row.year,
    materials: row.materials,
    finish: row.finish,
    colour_family: row.colour_family,
    source_url: row.source_url,
    source_note: row.source_note,
    notes: row.notes,
    size_tenths_mm: size,
    size_text: sizeText(size),
    swatch: row.swatch,
    swatch_source: row.swatch_source,
    captured_at: row.captured_at,
    trashed_at: row.trashed_at,
    purge_at: row.purge_at,
    photo: {
      original_url: `/api/references/${row.id}/original`,
      display_url: `/api/references/${row.id}/display`,
      content_type: row.photo_content_type,
      bytes: row.photo_bytes,
      sha256: row.photo_sha256,
      width: row.photo_width,
      height: row.photo_height,
    },
  };
}

export function toSearchDocument(row: ReferenceRow): SearchDocument {
  return {
    id: row.id,
    title: row.title,
    maker: row.maker,
    year: row.year,
    materials: row.materials,
    finish: row.finish,
    colour_family: row.colour_family,
    notes: row.notes,
  };
}

export async function loadReference(
  client: Queryable,
  id: string,
): Promise<ReferenceRow | null> {
  const result = await client.query<ReferenceRow>(
    `select ${REFERENCE_COLUMNS} from reference where id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function loadReferences(ids: string[]): Promise<Map<string, ReferenceRow>> {
  if (ids.length === 0) return new Map();
  const result = await pool.query<ReferenceRow>(
    `select ${REFERENCE_COLUMNS} from reference where id = any($1::text[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

export interface ReferenceFilters {
  colour_family?: string;
  material?: string;
  finish?: string;
}

function filterClauses(
  filters: ReferenceFilters,
  parameters: unknown[],
): string {
  const clauses: string[] = [];
  if (filters.colour_family) {
    parameters.push(filters.colour_family);
    clauses.push(`colour_family = $${parameters.length}`);
  }
  if (filters.material) {
    parameters.push(filters.material);
    clauses.push(`$${parameters.length} = any(materials)`);
  }
  if (filters.finish) {
    parameters.push(filters.finish);
    clauses.push(`finish = $${parameters.length}`);
  }
  return clauses.length > 0 ? ` and ${clauses.join(' and ')}` : '';
}

/** Stored references, newest capture first. */
export async function listStored(filters: ReferenceFilters = {}): Promise<ReferenceRow[]> {
  const parameters: unknown[] = [];
  const where = filterClauses(filters, parameters);
  const result = await pool.query<ReferenceRow>(
    `select ${REFERENCE_COLUMNS} from reference
     where state = 'stored'${where}
     order by captured_at desc, id desc`,
    parameters,
  );
  return result.rows;
}

/** The fallback match: `q` as a case-insensitive substring of the searchable text. */
export async function fallbackSearch(
  query: string,
  filters: ReferenceFilters,
): Promise<ReferenceRow[]> {
  const parameters: unknown[] = [query];
  const where = filterClauses(filters, parameters);
  const result = await pool.query<ReferenceRow>(
    `select ${REFERENCE_COLUMNS} from reference
     where state = 'stored'${where}
       and ($1 = '' or
            title ilike '%' || $1 || '%' or
            coalesce(maker, '') ilike '%' || $1 || '%' or
            coalesce(notes, '') ilike '%' || $1 || '%' or
            coalesce(finish, '') ilike '%' || $1 || '%' or
            exists (select 1 from unnest(materials) as material
                    where material ilike '%' || $1 || '%'))
     order by captured_at desc, id desc`,
    parameters,
  );
  return result.rows;
}
