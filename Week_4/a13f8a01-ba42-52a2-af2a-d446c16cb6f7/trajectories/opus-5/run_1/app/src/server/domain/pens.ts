import type { ForkedFrom, Pen, PenSummary, Version, VersionEntry, Visibility } from '../../shared/api';
import { one, query } from '../db';
import { apiError, notFound } from '../errors';
import { isoTime } from '../util';

export interface PenRow {
  id: string;
  owner_id: string;
  owner_handle: string;
  title: string;
  visibility: Visibility;
  head: number;
  tags: string[];
  source_pen_id: string | null;
  source_version: number | null;
  updated_at: Date;
  likes: number;
  forks: number;
}

export interface VersionRow {
  pen_id: string;
  number: number;
  created_at: Date;
  sha256: string;
  restored_from: number | null;
  html: string;
  css: string;
  js: string;
  libraries: string[];
  added: number;
  removed: number;
  changed_chars: number;
}

export const PEN_SELECT = `
select p.id, p.owner_id, u.handle as owner_handle, p.title, p.visibility, p.head, p.tags,
       p.source_pen_id, p.source_version, p.updated_at,
       (select count(*) from likes l where l.pen_id = p.id)::int as likes,
       (select count(*) from pens f where f.source_pen_id = p.id)::int as forks
  from pens p join users u on u.id = p.owner_id`;

/** The one place that decides whether a viewer may see a pen. */
export const visibleTo = (pen: PenRow, viewerId: string | null): boolean =>
  pen.visibility !== 'private' || pen.owner_id === viewerId;

export const findPen = async (id: string): Promise<PenRow | null> =>
  one<PenRow>(`${PEN_SELECT} where p.id = $1`, [id]);

/** A pen the viewer may not see answers exactly as a pen that never existed. */
export const requireVisiblePen = async (id: string, viewerId: string | null): Promise<PenRow> => {
  const pen = await findPen(id);
  if (!pen || !visibleTo(pen, viewerId)) throw notFound();
  return pen;
};

export const requireOwnedPen = async (id: string, viewerId: string | null): Promise<PenRow> => {
  const pen = await requireVisiblePen(id, viewerId);
  if (pen.owner_id !== viewerId) throw apiError('forbidden');
  return pen;
};

export const penSummary = (pen: PenRow): PenSummary => ({
  id: pen.id,
  title: pen.title,
  owner: pen.owner_handle,
  visibility: pen.visibility,
  tags: pen.tags,
  head: pen.head,
  updated_at: isoTime(pen.updated_at),
  likes: pen.likes,
  forks: pen.forks,
});

export const versionShape = (row: VersionRow): Version => ({
  pen_id: row.pen_id,
  number: row.number,
  created_at: isoTime(row.created_at),
  sha256: row.sha256,
  files: { html: row.html, css: row.css, js: row.js },
  libraries: row.libraries,
  restored_from: row.restored_from,
});

export const versionEntry = (row: VersionRow): VersionEntry => ({
  number: row.number,
  created_at: isoTime(row.created_at),
  sha256: row.sha256,
  restored_from: row.restored_from,
  added: row.added,
  removed: row.removed,
  changed_chars: row.changed_chars,
});

export const findVersion = async (penId: string, number: number): Promise<VersionRow | null> =>
  one<VersionRow>('select * from versions where pen_id = $1 and number = $2', [penId, number]);

export const requireVersion = async (penId: string, number: number): Promise<VersionRow> => {
  const row = await findVersion(penId, number);
  if (!row) throw notFound();
  return row;
};

export const listVersions = async (penId: string): Promise<VersionRow[]> =>
  query<VersionRow>('select * from versions where pen_id = $1 order by number asc', [penId]);

const forkedFrom = async (pen: PenRow, viewerId: string | null): Promise<ForkedFrom> => {
  if (!pen.source_pen_id || pen.source_version === null) return null;
  const source = await findPen(pen.source_pen_id);
  if (!source) return { removed: true };
  if (!visibleTo(source, viewerId)) return { hidden: true };
  return {
    pen_id: source.id,
    version: pen.source_version,
    title: source.title,
    owner: source.owner_handle,
  };
};

export const penShape = async (pen: PenRow, viewerId: string | null): Promise<Pen> => {
  const head = pen.head > 0 ? await findVersion(pen.id, pen.head) : null;
  const liked = viewerId
    ? (await one<{ one: number }>('select 1 as one from likes where user_id = $1 and pen_id = $2', [
        viewerId,
        pen.id,
      ])) !== null
    : false;
  return {
    ...penSummary(pen),
    liked,
    forked_from: await forkedFrom(pen, viewerId),
    version: head ? versionShape(head) : null,
  };
};
