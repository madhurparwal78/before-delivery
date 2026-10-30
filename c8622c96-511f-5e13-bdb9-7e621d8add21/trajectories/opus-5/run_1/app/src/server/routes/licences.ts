import type { LicenceKind } from '../../domain/licensing.js';
import { isoInstant } from '../../domain/time.js';
import { parseBody, stringField, type FieldErrors } from '../../domain/validate.js';
import { serverNow } from '../clock.js';
import { db, queryOn } from '../db/pool.js';
import { loadEssay, loadFrame, requireVisibleEssay } from '../data/essays.js';
import { licenceView, loadLicence, newsroomLicences, stateAt } from '../data/licences.js';
import { createLicence } from '../licensing.js';
import { ApiError, apiError, notFound, validationFailed } from '../http/errors.js';
import {
  jsonBody,
  requireNewsroom,
  requireRole,
  requireSession,
  type Reply,
  type RequestContext,
  type Route,
  type SignedInPerson,
} from '../http/router.js';
import { objectExists, presignOriginal } from '../services/storage.js';

const KIND_MESSAGE = 'Kind must be exclusive or standard';
const KEY_MESSAGE = 'Send an Idempotency-Key header of 1 to 100 visible characters';
const GRANT_LINK_SECONDS = 300;

function idempotencyKey(ctx: RequestContext): string | null {
  const header = ctx.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  return /^[\x21-\x7E]{1,100}$/.test(value) ? value : null;
}

interface StoredResponse {
  status: number;
  body: unknown;
}

async function replayOrRun(
  person: SignedInPerson,
  key: string,
  essayId: string,
  kind: string,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const inserted = await queryOn<{ idempotency_key: string }>(
    db,
    `insert into idempotency_records (person_id, idempotency_key, essay_id, kind)
     values ($1, $2, $3, $4)
     on conflict (person_id, idempotency_key) do nothing
     returning idempotency_key`,
    [person.id, key, essayId, kind],
  );
  if (inserted.rows.length === 0) {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const existing = await queryOn<{
        essay_id: string;
        kind: string;
        status_code: number | null;
        response: unknown;
        completed: boolean;
      }>(
        db,
        `select essay_id, kind, status_code, response, completed
         from idempotency_records where person_id = $1 and idempotency_key = $2`,
        [person.id, key],
      );
      const record = existing.rows[0];
      if (!record) break;
      if (record.essay_id !== essayId || record.kind !== kind) {
        throw apiError(409, 'idempotency_key_reused', 'That Idempotency-Key answered a different request.');
      }
      if (record.completed && record.status_code !== null) {
        return { status: record.status_code, body: record.response };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw apiError(409, 'idempotency_key_reused', 'That Idempotency-Key answered a different request.');
  }
  try {
    const result = await run();
    await queryOn(
      db,
      `update idempotency_records set status_code = $3, response = $4, completed = true
       where person_id = $1 and idempotency_key = $2`,
      [person.id, key, result.status, JSON.stringify(result.body)],
    );
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      await queryOn(
        db,
        `update idempotency_records set status_code = $3, response = $4, completed = true
         where person_id = $1 and idempotency_key = $2`,
        [person.id, key, error.status, JSON.stringify(error.body())],
      );
    } else {
      await queryOn(
        db,
        'delete from idempotency_records where person_id = $1 and idempotency_key = $2',
        [person.id, key],
      );
    }
    throw error;
  }
}

export const licenceRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/essays/:id/licences',
    async handle(ctx): Promise<Reply> {
      const viewer = requireSession(ctx);
      const essay = await requireVisibleEssay(db, ctx.params.id as string, viewer);
      const person = requireRole(ctx, 'picture_editor');
      const newsroom = requireNewsroom(person);
      const key = idempotencyKey(ctx);
      const parsed = parseBody<{ kind: LicenceKind }>(jsonBody(ctx), {
        kind: stringField(KIND_MESSAGE, (value) =>
          value === 'exclusive' || value === 'standard' ? null : KIND_MESSAGE,
        ),
      });
      const fields: FieldErrors = parsed.ok ? {} : { ...parsed.fields };
      if (!key) fields.idempotency_key = KEY_MESSAGE;
      const validationFields = Object.keys(fields).length > 0 ? fields : null;
      const kind = parsed.ok ? parsed.value.kind : null;
      const request = {
        essayId: essay.id,
        person,
        newsroomSlug: newsroom,
        kind,
        validationFields,
      };
      const run = async (): Promise<StoredResponse> => {
        const outcome = await createLicence(request);
        const now = await serverNow();
        return { status: outcome.status, body: await licenceView(db, outcome.licence, now) };
      };
      const result = key ? await replayOrRun(person, key, essay.id, kind ?? 'invalid', run) : await run();
      return { status: result.status, json: result.body };
    },
  },
  {
    method: 'GET',
    pattern: '/api/licences',
    roles: ['picture_editor', 'licensing_manager'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor', 'licensing_manager');
      const newsroom = requireNewsroom(person);
      const now = await serverNow();
      const rows = await newsroomLicences(db, newsroom, now);
      const licences = [];
      for (const row of rows) licences.push(await licenceView(db, row, now));
      return { status: 200, json: { licences } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/licences/:id',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'picture_editor', 'licensing_manager');
      const newsroom = requireNewsroom(person);
      const now = await serverNow();
      const licence = await loadLicence(db, ctx.params.id as string, now);
      if (!licence || licence.newsroom_slug !== newsroom) throw notFound();
      return { status: 200, json: await licenceView(db, licence, now) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/licences/:id/grants',
    async handle(ctx): Promise<Reply> {
      const viewer = requireSession(ctx);
      const now = await serverNow();
      const licence = await loadLicence(db, ctx.params.id as string, now);
      if (!licence || licence.newsroom_slug !== viewer.newsroomSlug) throw notFound();
      requireRole(ctx, 'picture_editor');
      const parsed = parseBody<{ frame_id: string }>(jsonBody(ctx), {
        frame_id: {
          message: 'This field is missing or has the wrong type',
          check: (value) =>
            typeof value === 'string' ? null : 'This field is missing or has the wrong type',
        },
      });
      const state = stateAt(licence, now);
      if (state === 'revoked') {
        throw apiError(410, 'licence_revoked', 'This licence was revoked after a legal takedown.');
      }
      if (state === 'pending_invoice') {
        throw apiError(409, 'licence_pending', 'The invoice for this licence is still pending.');
      }
      if (state === 'expired') {
        throw apiError(410, 'licence_ended', 'This licence has ended.');
      }
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const frame = await loadFrame(db, parsed.value.frame_id);
      if (!frame || frame.essay_id !== licence.essay_id) throw notFound();
      const essay = await loadEssay(db, licence.essay_id);
      if (!essay) throw notFound();
      const remainingMs = licence.window_end.getTime() - now.getTime();
      if (remainingMs <= 0) throw apiError(410, 'licence_ended', 'This licence has ended.');
      const seconds = Math.max(1, Math.min(GRANT_LINK_SECONDS, Math.floor(remainingMs / 1000)));
      if (!(await objectExists(`originals/${essay.id}/${frame.id}`))) {
        throw apiError(503, 'storage_unavailable', 'Image storage is unreachable right now.');
      }
      const extension = frame.content_type === 'image/png' ? 'png' : 'jpg';
      const url = presignOriginal(
        essay.id,
        frame.id,
        seconds,
        `${essay.id}-frame-${frame.position}.${extension}`,
        frame.content_type,
      );
      return {
        status: 201,
        json: { url, expires_at: isoInstant(new Date(now.getTime() + seconds * 1000)) },
      };
    },
  },
];
