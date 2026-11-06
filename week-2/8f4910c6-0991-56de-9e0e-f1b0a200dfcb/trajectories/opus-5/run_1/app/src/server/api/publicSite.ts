import { queryOne, query } from '../db.js';
import { gone, notFound, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import { cardView, findTalentBySlug, photosFor, photosOf, profileView, type TalentRow } from '../data/talent.js';
import { loadOffices, officeView } from '../data/offices.js';
import { getObject } from '../services/storage.js';
import { BOARDS, OFFICES, type Board, type OfficeId } from '../../shared/types.js';
import { BOARD_TITLES } from '../../shared/format.js';
import { castRequestEmail } from '../emails.js';
import { queueMail } from '../services/mail.js';
import { newId } from '../ids.js';
import { nextCounter } from '../schema.js';
import {
  FieldErrors,
  EMAIL_PATTERN,
  cleanSingleLine,
  fieldCopy,
  json,
  readArray,
  readNumber,
  readRecord,
  readString,
} from './helpers.js';
import { parseIsoDate } from '../../shared/zone.js';

const PAGE_SIZE = 6;
const TRAY_LIMIT = 12;

type SortKey = 'name' | 'height' | 'reach';

async function activeTalent(): Promise<TalentRow[]> {
  return query<TalentRow>(`SELECT * FROM talent WHERE state = 'active' ORDER BY display_name`);
}

function reachTotal(row: TalentRow): number {
  return row.instagram + row.tiktok + row.youtube;
}

function sortTalent(rows: TalentRow[], sort: SortKey): TalentRow[] {
  const byName = (a: TalentRow, b: TalentRow): number => a.display_name.localeCompare(b.display_name, 'en');
  return [...rows].sort((a, b) => {
    if (sort === 'height') return (b.height_cm ?? 0) - (a.height_cm ?? 0) || byName(a, b);
    if (sort === 'reach') return reachTotal(b) - reachTotal(a) || byName(a, b);
    return byName(a, b);
  });
}

export const publicRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/offices',
    auth: 'public',
    handler: async (): Promise<Reply> => {
      const offices = await loadOffices();
      return json(200, { offices: [...offices.values()].map((office) => officeView(office)) });
    },
  },
  {
    method: 'GET',
    path: '/api/public/boards',
    auth: 'public',
    handler: async (): Promise<Reply> => {
      const rows = await activeTalent();
      const photos = await photosFor(rows.map((row) => row.id));
      const boards = BOARDS.map((board) => {
        const members = rows.filter((row) => row.board === board);
        const cover = members.find((row) => (photos.get(row.id) ?? []).length > 0);
        const coverPhotos = cover ? photos.get(cover.id) ?? [] : [];
        return {
          board,
          title: BOARD_TITLES[board],
          count: members.length,
          coverPhotoUrl: coverPhotos.length > 0 ? `/api/photos/${coverPhotos[0].id}` : null,
        };
      });
      return json(200, { boards });
    },
  },
  {
    method: 'GET',
    path: '/api/public/talent',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const params = ctx.url.searchParams;
      const board = params.get('board') ?? '';
      const office = params.get('office') ?? '';
      const sort = params.get('sort') ?? 'name';
      const search = (params.get('q') ?? '').trim().toLowerCase();
      const pageParam = params.get('page') ?? '1';
      const errors: Record<string, string> = {};
      if (board && !BOARDS.includes(board as Board)) errors.board = 'Choose one of the published boards.';
      if (office && office !== 'all' && !OFFICES.includes(office as OfficeId)) {
        errors.office = 'Choose one of the published offices.';
      }
      if (!['name', 'height', 'reach'].includes(sort)) errors.sort = 'Choose one of the published sorts.';
      if (Object.keys(errors).length > 0) throw validation(errors);
      const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);

      let rows = await activeTalent();
      if (board) rows = rows.filter((row) => row.board === board);
      if (office && office !== 'all') rows = rows.filter((row) => row.office_id === office);
      if (search) rows = rows.filter((row) => row.display_name.toLowerCase().includes(search));
      rows = sortTalent(rows, sort as SortKey);

      const total = rows.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const pageRows = rows.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE);
      const photos = await photosFor(pageRows.map((row) => row.id));
      return json(200, {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
        talent: pageRows.map((row) => cardView(row, photos.get(row.id) ?? [])),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/public/talent/:slug',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await findTalentBySlug(ctx.params.slug);
      if (!row) throw notFound();
      if (row.state !== 'active') throw gone();
      return json(200, profileView(row, await photosOf(row.id)));
    },
  },
  {
    method: 'GET',
    path: '/api/photos/:photoId',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await queryOne<{ object_key: string; state: string }>(
        `SELECT p.object_key, t.state FROM photos p JOIN talent t ON t.id = p.talent_id WHERE p.id = $1`,
        [ctx.params.photoId],
      );
      if (!row || row.state !== 'active') throw notFound();
      const bytes = await getObject(row.object_key);
      if (!bytes) throw notFound();
      return {
        status: 200,
        body: bytes,
        contentType: 'image/jpeg',
        headers: { 'Cache-Control': 'no-store' },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/cast-requests/checks',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const step = readNumber(ctx.json, 'step') ?? 0;
      const draft = readRecord(ctx.json, 'draft') ?? {};
      const fields = await validateCastRequest(draft, step);
      fields.throwIfAny();
      return json(200, { ok: true });
    },
  },
  {
    method: 'POST',
    path: '/api/cast-requests',
    auth: 'public',
    body: 'json',
    idempotency: true,
    limiter: { bucket: 'cast_requests', limit: 5, windowSeconds: 60 },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const fields = await validateCastRequest(ctx.json, 4);
      fields.throwIfAny();
      const name = cleanSingleLine(readString(ctx.json, 'name') ?? '');
      const company = cleanSingleLine(readString(ctx.json, 'company') ?? '');
      const email = cleanSingleLine(readString(ctx.json, 'email') ?? '');
      const office = cleanSingleLine(readString(ctx.json, 'office') ?? '') as OfficeId;
      const shootDate = readString(ctx.json, 'shootDate') ?? '';
      const brief = readString(ctx.json, 'brief') ?? '';
      const slugs = (readArray(ctx.json, 'talentSlugs') ?? []).map((slug) => String(slug));

      const talent = await query<TalentRow>(
        `SELECT * FROM talent WHERE slug = ANY($1::text[]) AND state = 'active'`,
        [slugs],
      );
      const ordered = slugs
        .map((slug) => talent.find((row) => row.slug === slug))
        .filter((row): row is TalentRow => row !== undefined);

      const id = newId('cr');
      const reference = `CR-${String(await nextCounter('cast_request')).padStart(6, '0')}`;
      await query(
        `INSERT INTO cast_requests (id, reference, name, company, email, office_id, shoot_date, brief, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, reference, name, company, email, office, shootDate, brief, new Date(ctx.nowMs)],
      );
      for (const [index, row] of ordered.entries()) {
        await query(
          'INSERT INTO cast_request_talent (cast_request_id, talent_id, position) VALUES ($1, $2, $3)',
          [id, row.id, index],
        );
      }
      await queueMail(
        castRequestEmail({
          office,
          reference,
          name,
          company,
          email,
          shootDate,
          brief,
          talentNames: ordered.map((row) => row.display_name),
        }),
      );
      return json(201, { id, reference, receivedAt: new Date(ctx.nowMs).toISOString().replace(/\.\d+Z$/, 'Z') });
    },
  },
];

const CAST_STEP_FIELDS: Record<number, string[]> = {
  1: ['talentSlugs'],
  2: ['name', 'company', 'email', 'office'],
  3: ['shootDate', 'brief'],
  4: ['talentSlugs', 'name', 'company', 'email', 'office', 'shootDate', 'brief'],
};

async function validateCastRequest(draft: Record<string, unknown>, step: number): Promise<FieldErrors> {
  const fields = new FieldErrors();
  const wanted = CAST_STEP_FIELDS[step] ?? CAST_STEP_FIELDS[4];
  const has = (field: string): boolean => wanted.includes(field);

  if (has('talentSlugs')) {
    const slugs = (readArray(draft, 'talentSlugs') ?? []).map((value) => String(value));
    if (slugs.length === 0 || slugs.length > TRAY_LIMIT) {
      fields.add('talentSlugs', fieldCopy.required('Your tray'));
    } else {
      const rows = await query<TalentRow>('SELECT * FROM talent WHERE slug = ANY($1::text[])', [slugs]);
      for (const slug of slugs) {
        const row = rows.find((candidate) => candidate.slug === slug);
        if (!row) {
          fields.add('talentSlugs', fieldCopy.trayTalentGone(slug));
        } else if (row.state !== 'active') {
          fields.add('talentSlugs', fieldCopy.trayTalentGone(row.display_name));
        }
      }
    }
  }
  if (has('name') && !cleanSingleLine(readString(draft, 'name') ?? '')) {
    fields.add('name', fieldCopy.required('Your name'));
  }
  if (has('company') && !cleanSingleLine(readString(draft, 'company') ?? '')) {
    fields.add('company', fieldCopy.required('Company'));
  }
  if (has('email')) {
    const email = cleanSingleLine(readString(draft, 'email') ?? '');
    if (!email) fields.add('email', fieldCopy.required('Email'));
    else if (!EMAIL_PATTERN.test(email)) fields.add('email', fieldCopy.email());
  }
  if (has('office')) {
    const office = cleanSingleLine(readString(draft, 'office') ?? '');
    if (!OFFICES.includes(office as OfficeId)) fields.add('office', fieldCopy.required('Office'));
  }
  if (has('shootDate')) {
    const shootDate = readString(draft, 'shootDate') ?? '';
    if (!shootDate || !parseIsoDate(shootDate)) fields.add('shootDate', fieldCopy.required('Shoot date'));
  }
  if (has('brief') && !(readString(draft, 'brief') ?? '').trim()) {
    fields.add('brief', fieldCopy.required('Brief'));
  }
  return fields;
}
