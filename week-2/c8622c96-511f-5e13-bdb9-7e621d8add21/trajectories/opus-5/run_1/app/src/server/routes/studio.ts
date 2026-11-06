import { randomUUID } from 'node:crypto';
import {
  essayBodySpec,
  FRAME_CAPTION_MESSAGE,
  frameCaptionSpec,
  trimTitle,
  type CreditInput,
  type EssayFieldsInput,
} from '../../domain/essayFields.js';
import { isLegalEssayAction } from '../../domain/lifecycle.js';
import { displayCoopTime, isoInstant, resolveCoopWallTime } from '../../domain/time.js';
import { codePointLength, parseBody } from '../../domain/validate.js';
import { serverNow } from '../clock.js';
import { db, queryOn, withEssayLock, withTransaction } from '../db/pool.js';
import {
  bumpEssayVersion,
  essayView,
  essaysCrediting,
  isCredited,
  loadEssay,
  loadEssayForUpdate,
  loadFrame,
  loadFrames,
  requireVisibleEssay,
  type EssayRow,
} from '../data/essays.js';
import { essayLicences, stateAt } from '../data/licences.js';
import { contributorNames } from '../data/people.js';
import { requestWithdrawal } from '../desk.js';
import {
  apiError,
  forbidden,
  illegalTransition,
  notFound,
  validationFailed,
} from '../http/errors.js';
import { displayFilename, parseMultipart } from '../http/multipart.js';
import {
  jsonBody,
  requireRole,
  requireSession,
  type Reply,
  type RequestContext,
  type Route,
  type SignedInPerson,
} from '../http/router.js';
import { buildDerivatives, decodeRaster, sniffOriginalType } from '../images.js';
import { putDerivative, putOriginal } from '../services/storage.js';

const MAX_FRAMES = 24;
const MAX_ORIGINAL_BYTES = 25_000_000;

async function essayReply(essay: EssayRow, person: SignedInPerson, status = 200): Promise<Reply> {
  const now = await serverNow();
  const fresh = (await loadEssay(db, essay.id)) ?? essay;
  const view = await essayView(db, fresh, person, now, { newsroomView: false });
  return { status, json: view, headers: { etag: `"${fresh.version}"` } };
}

async function requireCredited(essayId: string, person: SignedInPerson): Promise<EssayRow> {
  const essay = await requireVisibleEssay(db, essayId, person);
  if (person.role !== 'contributor' || !(await isCredited(db, essayId, person.contributorHandle))) {
    throw forbidden();
  }
  return essay;
}

function slugify(title: string): string {
  const slug = trimTitle(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'essay';
}

async function creditsContext(person: SignedInPerson): Promise<{ knownHandles: Set<string>; signerHandle: string }> {
  const names = await contributorNames();
  return { knownHandles: new Set(names.keys()), signerHandle: person.contributorHandle ?? '' };
}

async function writeCredits(
  client: Parameters<typeof queryOn>[0],
  essayId: string,
  credits: CreditInput[],
): Promise<void> {
  await queryOn(client, 'delete from essay_credits where essay_id = $1', [essayId]);
  for (let index = 0; index < credits.length; index += 1) {
    const credit = credits[index] as CreditInput;
    await queryOn(
      client,
      'insert into essay_credits (essay_id, position, contributor_handle, split_bp) values ($1, $2, $3, $4)',
      [essayId, index + 1, credit.contributor, credit.split_bp],
    );
  }
}

function ifMatchVersion(ctx: RequestContext): number {
  const header = ctx.headers['if-match'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    throw apiError(428, 'precondition_required', 'Send If-Match with the essay version you read.');
  }
  const match = /^"(\d+)"$/.exec(value.trim());
  if (!match) {
    throw apiError(412, 'version_conflict', 'That is not the version this essay is on now.', {
      current_version: 0,
    });
  }
  return Number(match[1]);
}

async function uploadFrame(ctx: RequestContext, essay: EssayRow): Promise<Reply> {
  const parts = parseMultipart(ctx.rawBody, ctx.headers['content-type'] as string | undefined);
  const file = parts?.find((part) => part.name === 'file');
  const captionPart = parts?.find((part) => part.name === 'caption');
  if (!file) throw validationFailed({ file: 'Attach one original as the file field' });
  if (file.content.length > MAX_ORIGINAL_BYTES) {
    throw apiError(413, 'file_too_large', 'An original may be at most 25,000,000 bytes.');
  }
  const type = sniffOriginalType(file.content);
  if (!type) throw apiError(415, 'unsupported_type', 'Originals must be JPEG or PNG.');
  const caption = captionPart ? captionPart.content.toString('utf8') : '';
  if (codePointLength(caption) > 500) throw validationFailed({ caption: FRAME_CAPTION_MESSAGE });
  const frames = await loadFrames(db, essay.id);
  if (frames.length >= MAX_FRAMES) {
    throw validationFailed({ file: 'An essay holds at most 24 frames' });
  }
  const raster = decodeRaster(file.content, type);
  if (!raster) throw validationFailed({ file: "This file can't be read as an image" });
  const frameId = randomUUID();
  const derivatives = buildDerivatives(raster);
  await putOriginal(essay.id, frameId, file.content, type);
  await putDerivative(essay.id, frameId, 'grid', derivatives.grid);
  await putDerivative(essay.id, frameId, 'story', derivatives.story);
  await putDerivative(essay.id, frameId, 'preview', derivatives.preview);
  const position = frames.length + 1;
  const version = await withEssayLock(essay.id, async (client) => {
    await queryOn(
      client,
      `insert into frames (id, essay_id, position, caption, filename, bytes, content_type, width, height)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        frameId,
        essay.id,
        position,
        caption,
        displayFilename(file.filename),
        file.content.length,
        type,
        raster.width,
        raster.height,
      ],
    );
    return bumpEssayVersion(client, essay.id);
  });
  return {
    status: 201,
    json: {
      id: frameId,
      position,
      caption,
      filename: displayFilename(file.filename),
      bytes: file.content.length,
      type,
      width: raster.width,
      height: raster.height,
      essay_version: version,
    },
    headers: { etag: `"${version}"` },
  };
}

export const studioRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/essays',
    roles: ['contributor'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const context = await creditsContext(person);
      const parsed = parseBody<EssayFieldsInput>(jsonBody(ctx), essayBodySpec(context, false));
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const fields = parsed.value;
      const lift = resolveCoopWallTime(fields.lift_local);
      const base = slugify(fields.title);
      const essay = await withTransaction(async (client) => {
        let id = base;
        const taken = await queryOn<{ one: number }>(client, 'select 1 as one from essays where id = $1', [id]);
        if (taken.rows.length > 0) id = `${base}-${randomUUID().slice(0, 6)}`;
        const inserted = await queryOn<EssayRow>(
          client,
          `insert into essays (id, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
             standard_days, exclusive_price_minor, standard_price_minor, state, version)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', 1)
           returning id, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
             standard_days, exclusive_price_minor, standard_price_minor, state, version,
             withdrawal_requested, submitted_at`,
          [
            id,
            trimTitle(fields.title),
            fields.caption,
            fields.lift_local,
            lift.at,
            lift.resolution,
            fields.exclusive_days,
            fields.standard_days,
            fields.exclusive_price_minor,
            fields.standard_price_minor,
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw notFound();
        await writeCredits(client, row.id, fields.credits);
        return row;
      });
      return essayReply(essay, person, 201);
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/essays/:id',
    async handle(ctx): Promise<Reply> {
      const person = requireSession(ctx);
      const essay = await requireCredited(ctx.params.id as string, person);
      const expected = ifMatchVersion(ctx);
      const context = await creditsContext(person);
      const parsed = parseBody<Partial<EssayFieldsInput>>(jsonBody(ctx), essayBodySpec(context, true));
      const updated = await withEssayLock(essay.id, async (client) => {
        const current = await loadEssayForUpdate(client, essay.id);
        if (!current) throw notFound();
        if (current.version !== expected) {
          throw apiError(412, 'version_conflict', 'This essay was changed elsewhere.', {
            current_version: current.version,
          });
        }
        if (!isLegalEssayAction(current.state, 'edit')) throw illegalTransition(current.state, 'edit');
        if (!parsed.ok) throw validationFailed(parsed.fields);
        const fields = parsed.value;
        const lift = fields.lift_local ? resolveCoopWallTime(fields.lift_local) : null;
        await queryOn(
          client,
          `update essays set
             title = coalesce($2, title),
             caption = coalesce($3, caption),
             lift_local = coalesce($4, lift_local),
             lift_at = coalesce($5, lift_at),
             lift_resolution = coalesce($6, lift_resolution),
             exclusive_days = coalesce($7, exclusive_days),
             standard_days = coalesce($8, standard_days),
             exclusive_price_minor = coalesce($9, exclusive_price_minor),
             standard_price_minor = coalesce($10, standard_price_minor),
             version = version + 1
           where id = $1`,
          [
            essay.id,
            fields.title === undefined ? null : trimTitle(fields.title),
            fields.caption ?? null,
            fields.lift_local ?? null,
            lift ? lift.at : null,
            lift ? lift.resolution : null,
            fields.exclusive_days ?? null,
            fields.standard_days ?? null,
            fields.exclusive_price_minor ?? null,
            fields.standard_price_minor ?? null,
          ],
        );
        if (fields.credits) await writeCredits(client, essay.id, fields.credits);
        const fresh = await loadEssayForUpdate(client, essay.id);
        if (!fresh) throw notFound();
        return fresh;
      });
      return essayReply(updated, person);
    },
  },
  {
    method: 'POST',
    pattern: '/api/essays/:id/frames',
    upload: true,
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const essay = await requireCredited(ctx.params.id as string, person);
      if (!isLegalEssayAction(essay.state, 'edit')) throw illegalTransition(essay.state, 'edit');
      return uploadFrame(ctx, essay);
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/frames/:id',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const frame = await loadFrame(db, ctx.params.id as string);
      if (!frame) throw notFound();
      const essay = await requireCredited(frame.essay_id, person);
      const parsed = parseBody<{ caption: string }>(jsonBody(ctx), frameCaptionSpec());
      const version = await withEssayLock(essay.id, async (client) => {
        const current = await loadEssayForUpdate(client, essay.id);
        if (!current) throw notFound();
        if (!isLegalEssayAction(current.state, 'edit')) throw illegalTransition(current.state, 'edit');
        if (!parsed.ok) throw validationFailed(parsed.fields);
        await queryOn(client, 'update frames set caption = $2 where id = $1', [
          frame.id,
          parsed.value.caption,
        ]);
        return bumpEssayVersion(client, essay.id);
      });
      return {
        status: 200,
        json: {
          id: frame.id,
          position: frame.position,
          caption: parsed.ok ? parsed.value.caption : frame.caption,
          filename: frame.filename,
          bytes: frame.bytes,
          type: frame.content_type,
          width: frame.width,
          height: frame.height,
          essay_version: version,
        },
        headers: { etag: `"${version}"` },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/frames/:id',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const frame = await loadFrame(db, ctx.params.id as string);
      if (!frame) throw notFound();
      const essay = await requireCredited(frame.essay_id, person);
      const version = await withEssayLock(essay.id, async (client) => {
        const current = await loadEssayForUpdate(client, essay.id);
        if (!current) throw notFound();
        if (!isLegalEssayAction(current.state, 'edit')) throw illegalTransition(current.state, 'edit');
        await queryOn(client, 'delete from frames where id = $1', [frame.id]);
        await queryOn(
          client,
          'update frames set position = position - 1 where essay_id = $1 and position > $2',
          [essay.id, frame.position],
        );
        return bumpEssayVersion(client, essay.id);
      });
      return { status: 204, headers: { etag: `"${version}"` } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/essays/:id/submit',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const essay = await requireCredited(ctx.params.id as string, person);
      const parsed = parseBody<Record<string, never>>(jsonBody(ctx), {});
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const submitted = await withEssayLock(essay.id, async (client) => {
        const current = await loadEssayForUpdate(client, essay.id);
        if (!current) throw notFound();
        if (!isLegalEssayAction(current.state, 'submit')) throw illegalTransition(current.state, 'submit');
        const frames = await loadFrames(client, essay.id);
        if (frames.length === 0) {
          throw validationFailed({ frames: 'Add at least one frame before submitting' });
        }
        const now = await serverNow();
        const updated = await queryOn<EssayRow>(
          client,
          `update essays set state = 'in_review', submitted_at = $2, version = version + 1
           where id = $1
           returning id, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
             standard_days, exclusive_price_minor, standard_price_minor, state, version,
             withdrawal_requested, submitted_at`,
          [essay.id, now],
        );
        const row = updated.rows[0];
        if (!row) throw notFound();
        return row;
      });
      return essayReply(submitted, person);
    },
  },
  {
    method: 'POST',
    pattern: '/api/essays/:id/withdrawal-request',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const essay = await requireCredited(ctx.params.id as string, person);
      const parsed = parseBody<Record<string, never>>(jsonBody(ctx), {});
      if (!parsed.ok) throw validationFailed(parsed.fields);
      await requestWithdrawal(essay.id);
      const fresh = await loadEssay(db, essay.id);
      if (!fresh) throw notFound();
      return essayReply(fresh, person);
    },
  },
  {
    method: 'GET',
    pattern: '/api/studio/essays',
    roles: ['contributor'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const now = await serverNow();
      const essays = await essaysCrediting(db, person.contributorHandle ?? '');
      const rooms = await queryOn<{ slug: string; name: string }>(db, 'select slug, name from newsrooms');
      const newsrooms = new Map(rooms.rows.map((room) => [room.slug, room.name]));
      const views = [];
      for (const essay of essays) {
        const view = await essayView(db, essay, person, now, { newsroomView: false });
        const licences = await essayLicences(db, essay.id, now);
        views.push({
          ...view,
          licences: licences.map((licence) => ({
            newsroom: {
              slug: licence.newsroom_slug,
              name: newsrooms.get(licence.newsroom_slug) ?? licence.newsroom_slug,
            },
            kind: licence.kind,
            state: stateAt(licence, now),
            window_end: isoInstant(licence.window_end),
            window_end_display: displayCoopTime(licence.window_end),
            amount_minor: licence.amount_minor,
          })),
        });
      }
      return { status: 200, json: { essays: views } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/studio/royalties',
    roles: ['contributor'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'contributor');
      const result = await queryOn<{
        month: string;
        licence_id: string;
        essay_title: string;
        position: number;
        split_bp: number;
        amount_minor: number;
      }>(
        db,
        `select s.month, s.licence_id, l.essay_title, s.position, s.split_bp, s.amount_minor
         from statement_shares s join statement_lines l
           on l.month = s.month and l.licence_id = s.licence_id
         where s.handle = $1
         order by s.month desc, l.confirmed_at, s.licence_id`,
        [person.contributorHandle ?? ''],
      );
      return { status: 200, json: { lines: result.rows } };
    },
  },
];
