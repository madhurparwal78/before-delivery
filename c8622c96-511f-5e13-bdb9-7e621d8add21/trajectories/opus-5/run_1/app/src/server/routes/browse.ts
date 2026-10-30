import { isLicensableState } from '../../domain/lifecycle.js';
import { displayCoopTime, isoInstant } from '../../domain/time.js';
import { isJsonObject, parseBody, type BodySpec } from '../../domain/validate.js';
import { randomUUID } from 'node:crypto';
import { serverNow } from '../clock.js';
import { db, queryOn } from '../db/pool.js';
import {
  essayView,
  feedEssays,
  isCredited,
  loadEssay,
  loadFrame,
  requireVisibleEssay,
  usesNewsroomView,
} from '../data/essays.js';
import { contributorNames } from '../data/people.js';
import { apiError, notFound, takenDown, validationFailed } from '../http/errors.js';
import {
  jsonBody,
  requireNewsroom,
  requireRole,
  requireSession,
  type Reply,
  type Route,
} from '../http/router.js';
import { getObject } from '../services/storage.js';

const FOLLOW_TARGET_MESSAGE = 'Follow one essay or one contributor';

const VARIANTS = ['grid', 'story', 'preview'] as const;
type Variant = (typeof VARIANTS)[number];

function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

const followSpec: BodySpec = {
  essay_id: {
    message: 'This field is missing or has the wrong type',
    optional: true,
    check: (value) => (typeof value === 'string' ? null : 'This field is missing or has the wrong type'),
  },
  contributor: {
    message: 'Unknown contributor',
    optional: true,
    check: (value) => (typeof value === 'string' ? null : FOLLOW_TARGET_MESSAGE),
  },
};

export const browseRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/feed',
    async handle(ctx): Promise<Reply> {
      const person = requireSession(ctx);
      const now = await serverNow();
      const essays = await feedEssays(db, person, ctx.query.get('q') ?? '', now);
      return { status: 200, json: { essays } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/essays/:id',
    async handle(ctx): Promise<Reply> {
      const person = requireSession(ctx);
      const essay = await requireVisibleEssay(db, ctx.params.id as string, person);
      const now = await serverNow();
      const view = await essayView(db, essay, person, now, { newsroomView: usesNewsroomView(person) });
      return { status: 200, json: view, headers: { etag: `"${essay.version}"` } };
    },
  },
  {
    method: 'GET',
    pattern: '/media/frames/:id/:variant',
    async handle(ctx): Promise<Reply> {
      const person = requireSession(ctx);
      const variant = ctx.params.variant as string;
      if (!isVariant(variant)) throw notFound();
      const frame = await loadFrame(db, ctx.params.id as string);
      if (!frame) throw notFound();
      const essay = await loadEssay(db, frame.essay_id);
      if (!essay) throw notFound();
      if (essay.state === 'taken_down') throw takenDown();
      await requireVisibleEssay(db, essay.id, person);
      if (variant === 'story') {
        const credited = await isCredited(db, essay.id, person.contributorHandle);
        if (!credited && person.role !== 'desk_editor') throw notFound();
      }
      const bytes = await getObject(`derivatives/${essay.id}/${frame.id}/${variant}.jpg`);
      if (!bytes) throw notFound();
      return {
        status: 200,
        body: bytes,
        contentType: 'image/jpeg',
        headers: { 'cache-control': 'private, max-age=60' },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/follows',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor');
      const raw = jsonBody(ctx);
      const parsed = parseBody<{ essay_id?: string; contributor?: string }>(raw, followSpec);
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const hasEssay = isJsonObject(raw) && Object.prototype.hasOwnProperty.call(raw, 'essay_id');
      const hasContributor = isJsonObject(raw) && Object.prototype.hasOwnProperty.call(raw, 'contributor');
      if (hasEssay === hasContributor) throw validationFailed({ target: FOLLOW_TARGET_MESSAGE });
      const now = await serverNow();
      if (hasEssay) {
        const essayId = parsed.value.essay_id as string;
        await requireVisibleEssay(db, essayId, person);
        const existing = await queryOn<{ id: string }>(
          db,
          'select id from follows where person_id = $1 and essay_id = $2',
          [person.id, essayId],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          return { status: 200, json: { id: existingRow.id, essay_id: essayId, contributor: null } };
        }
        const id = randomUUID();
        const inserted = await queryOn<{ id: string }>(
          db,
          `insert into follows (id, person_id, essay_id, created_at) values ($1, $2, $3, $4)
           on conflict (person_id, essay_id) where essay_id is not null do nothing returning id`,
          [id, person.id, essayId, now],
        );
        if (inserted.rows.length === 0) {
          const raced = await queryOn<{ id: string }>(
            db,
            'select id from follows where person_id = $1 and essay_id = $2',
            [person.id, essayId],
          );
          return {
            status: 200,
            json: { id: raced.rows[0]?.id ?? id, essay_id: essayId, contributor: null },
          };
        }
        return { status: 201, json: { id, essay_id: essayId, contributor: null } };
      }
      const handle = parsed.value.contributor as string;
      const names = await contributorNames();
      if (!names.has(handle)) throw validationFailed({ contributor: `Unknown contributor ${handle}` });
      const existing = await queryOn<{ id: string }>(
        db,
        'select id from follows where person_id = $1 and contributor_handle = $2',
        [person.id, handle],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        return { status: 200, json: { id: existingRow.id, essay_id: null, contributor: handle } };
      }
      const id = randomUUID();
      const inserted = await queryOn<{ id: string }>(
        db,
        `insert into follows (id, person_id, contributor_handle, created_at) values ($1, $2, $3, $4)
         on conflict (person_id, contributor_handle) where contributor_handle is not null do nothing
         returning id`,
        [id, person.id, handle, now],
      );
      if (inserted.rows.length === 0) {
        const raced = await queryOn<{ id: string }>(
          db,
          'select id from follows where person_id = $1 and contributor_handle = $2',
          [person.id, handle],
        );
        return {
          status: 200,
          json: { id: raced.rows[0]?.id ?? id, essay_id: null, contributor: handle },
        };
      }
      return { status: 201, json: { id, essay_id: null, contributor: handle } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/follows',
    roles: ['picture_editor'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor');
      const result = await queryOn<{
        id: string;
        essay_id: string | null;
        contributor: string | null;
        title: string | null;
        name: string | null;
      }>(
        db,
        `select f.id, f.essay_id, f.contributor_handle as contributor, e.title, p.name
         from follows f
         left join essays e on e.id = f.essay_id
         left join people p on p.contributor_handle = f.contributor_handle
         where f.person_id = $1 and (e.id is null or e.state <> 'taken_down')
         order by f.created_at, f.id`,
        [person.id],
      );
      return { status: 200, json: { follows: result.rows } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/follows/:id',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor');
      const deleted = await queryOn<{ id: string }>(
        db,
        'delete from follows where id = $1 and person_id = $2 returning id',
        [ctx.params.id as string, person.id],
      );
      if (deleted.rows.length === 0) throw notFound();
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    pattern: '/api/shortlist',
    roles: ['picture_editor', 'licensing_manager'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor', 'licensing_manager');
      const newsroom = requireNewsroom(person);
      const result = await queryOn<{
        id: string;
        essay_id: string;
        essay_title: string;
        frame_id: string;
        position: number;
        added_by: string;
        added_at: Date;
      }>(
        db,
        `select s.id, s.essay_id, e.title as essay_title, s.frame_id, f.position,
                p.name as added_by, s.added_at
         from shortlist_items s
         join essays e on e.id = s.essay_id
         join frames f on f.id = s.frame_id
         join people p on p.id = s.added_by
         where s.newsroom_slug = $1 and e.state <> 'taken_down'
         order by s.added_at, s.id`,
        [newsroom],
      );
      const items = result.rows.map((row) => ({
        id: row.id,
        essay_id: row.essay_id,
        essay_title: row.essay_title,
        frame_id: row.frame_id,
        position: row.position,
        added_by: row.added_by,
        added_at: isoInstant(row.added_at),
        added_display: displayCoopTime(row.added_at),
      }));
      return { status: 200, json: { items, count: items.length } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/shortlist',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor');
      const newsroom = requireNewsroom(person);
      const parsed = parseBody<{ frame_id: string }>(jsonBody(ctx), {
        frame_id: {
          message: 'This field is missing or has the wrong type',
          check: (value) =>
            typeof value === 'string' ? null : 'This field is missing or has the wrong type',
        },
      });
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const frame = await loadFrame(db, parsed.value.frame_id);
      if (!frame) throw notFound();
      const essay = await requireVisibleEssay(db, frame.essay_id, person);
      if (!isLicensableState(essay.state)) {
        throw apiError(409, 'not_licensable', 'This essay cannot be shortlisted right now.');
      }
      const existing = await queryOn<{ id: string; added_at: Date; added_by: string }>(
        db,
        `select s.id, s.added_at, p.name as added_by from shortlist_items s
         join people p on p.id = s.added_by
         where s.newsroom_slug = $1 and s.frame_id = $2`,
        [newsroom, frame.id],
      );
      const existingRow = existing.rows[0];
      const now = await serverNow();
      if (existingRow) {
        return {
          status: 200,
          json: {
            id: existingRow.id,
            essay_id: essay.id,
            essay_title: essay.title,
            frame_id: frame.id,
            position: frame.position,
            added_by: existingRow.added_by,
            added_at: isoInstant(existingRow.added_at),
            added_display: displayCoopTime(existingRow.added_at),
          },
        };
      }
      const id = randomUUID();
      await queryOn(
        db,
        `insert into shortlist_items (id, newsroom_slug, essay_id, frame_id, added_by, added_at)
         values ($1, $2, $3, $4, $5, $6) on conflict (newsroom_slug, frame_id) do nothing`,
        [id, newsroom, essay.id, frame.id, person.id, now],
      );
      const stored = await queryOn<{ id: string; added_at: Date }>(
        db,
        'select id, added_at from shortlist_items where newsroom_slug = $1 and frame_id = $2',
        [newsroom, frame.id],
      );
      const row = stored.rows[0];
      if (!row) throw notFound();
      return {
        status: row.id === id ? 201 : 200,
        json: {
          id: row.id,
          essay_id: essay.id,
          essay_title: essay.title,
          frame_id: frame.id,
          position: frame.position,
          added_by: person.name,
          added_at: isoInstant(row.added_at),
          added_display: displayCoopTime(row.added_at),
        },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/shortlist/:id',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor');
      const newsroom = requireNewsroom(person);
      const deleted = await queryOn<{ id: string }>(
        db,
        'delete from shortlist_items where id = $1 and newsroom_slug = $2 returning id',
        [ctx.params.id as string, newsroom],
      );
      if (deleted.rows.length === 0) throw notFound();
      return { status: 204 };
    },
  },
];
