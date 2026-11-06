import { randomUUID } from 'node:crypto';
import { COPY } from '../../domain/copy.js';
import { compareTitles, foldForCompare } from '../../domain/folding.js';
import { adIdProblem } from '../../domain/rules.js';
import { FRAME_RATES } from '../../domain/timecode.js';
import { toInstantText } from '../../domain/time.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { query } from '../infra/db.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import {
  addEvent,
  isoDateText,
  jobJson,
  newStamp,
  readFrames,
  requireClient,
  requireJob,
  requireWritableJob,
} from './support.js';
import type { JobRow } from './support.js';

const SORT_KEYS = ['title', 'dueDate'] as const;
const TARGET_SECONDS = [6, 15, 30, 60] as const;
const ASPECTS = ['16:9', '1:1', '9:16'] as const;
export const PAGE_LIMIT = 25;

type SortKey = (typeof SORT_KEYS)[number];

function sortJobs(jobs: JobRow[], key: SortKey): JobRow[] {
  return [...jobs].sort((a, b) => {
    const first =
      key === 'title'
        ? compareTitles(a.title, b.title)
        : isoDateText(a.due_date).localeCompare(isoDateText(b.due_date));
    return first !== 0 ? first : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function cursorOf(job: JobRow, key: SortKey): string {
  const value = key === 'title' ? foldForCompare(job.title) : isoDateText(job.due_date);
  return Buffer.from(`${value}\u0000${job.id}`, 'utf8').toString('base64url');
}

function isAfterCursor(job: JobRow, key: SortKey, cursor: string): boolean {
  const [value = '', id = ''] = Buffer.from(cursor, 'base64url').toString('utf8').split('\u0000');
  const own = key === 'title' ? foldForCompare(job.title) : isoDateText(job.due_date);
  if (own !== value) return own > value;
  return job.id > id;
}

export const jobRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const wantedState = context.query.get('state');
      const clientId = context.query.get('clientId');
      const frameRate = context.query.get('frameRate');
      const sort: SortKey = context.query.get('sort') === 'title' ? 'title' : 'dueDate';
      const askedLimit = Number(context.query.get('limit') ?? PAGE_LIMIT);
      const limit = Math.min(
        PAGE_LIMIT,
        Number.isFinite(askedLimit) && askedLimit > 0 ? Math.floor(askedLimit) : PAGE_LIMIT,
      );

      const all = await query<JobRow>(
        `select j.*, c.name as client_name, c.place as client_place, c.state as client_state
           from jobs j join clients c on c.id = j.client_id
          where j.desk_id = $1 and c.state <> 'erased'`,
        [desk.id],
      );
      const matching = all.filter((job) => {
        if (wantedState === 'archived' ? job.state !== 'archived' : job.state === 'archived') {
          return false;
        }
        if (wantedState !== null && wantedState !== 'archived' && job.state !== wantedState) {
          return false;
        }
        if (clientId !== null && job.client_id !== clientId) return false;
        if (frameRate !== null && job.frame_rate !== frameRate) return false;
        return true;
      });
      const ordered = sortJobs(matching, sort);
      const cursor = context.query.get('cursor');
      const start =
        cursor === null
          ? 0
          : ordered.findIndex((job) => isAfterCursor(job, sort, cursor)) === -1
            ? ordered.length
            : ordered.findIndex((job) => isAfterCursor(job, sort, cursor));
      const page = ordered.slice(start, start + limit);
      const last = page[page.length - 1];
      return {
        status: 200,
        body: {
          jobs: page.map(jobJson),
          total: ordered.length,
          nextCursor:
            last !== undefined && start + page.length < ordered.length
              ? cursorOf(last, sort)
              : null,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const clientId = fields.uuid(body, 'clientId');
      const title = fields.text(body, 'title', COPY.typeTitle);
      const adId = fields.optionalText(body, 'adId');
      const adProblem = adIdProblem(adId);
      if (adProblem !== null) fields.problem('adId', adProblem);
      const dueDate = fields.isoDate(body, 'dueDate');
      const targetSeconds = fields.numberChoice(body, 'targetSeconds', TARGET_SECONDS);
      const frameRate = fields.choice(body, 'frameRate', FRAME_RATES);
      const aspect = fields.choice(body, 'aspect', ASPECTS);
      fields.done();
      const client = await requireClient(desk.id, clientId);
      if (client.state !== 'active') throw refuse.state(COPY.clientClosing);
      const id = randomUUID();
      await query(
        `insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds,
                           frame_rate, aspect, state, stamp, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,now())`,
        [
          id,
          desk.id,
          client.id,
          title,
          adId,
          dueDate,
          targetSeconds,
          frameRate,
          aspect,
          newStamp(),
        ],
      );
      const job = await requireJob(desk.id, id);
      await addEvent(id, desk.name, 'jobAdded', `Job ${title} added.`);
      return { status: 201, body: jobJson(job) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      return { status: 200, body: jobJson(job) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/jobs/:id',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const title = 'title' in body ? fields.text(body, 'title', COPY.typeTitle) : job.title;
      const adId = 'adId' in body ? fields.optionalText(body, 'adId') : job.ad_id;
      if ('adId' in body) {
        const adProblem = adIdProblem(adId);
        if (adProblem !== null) fields.problem('adId', adProblem);
      }
      const dueDate =
        'dueDate' in body ? fields.isoDate(body, 'dueDate') : isoDateText(job.due_date);
      const targetSeconds =
        'targetSeconds' in body
          ? fields.numberChoice(body, 'targetSeconds', TARGET_SECONDS)
          : job.target_seconds;
      fields.done();
      requireWritableJob(job);
      await query(
        'update jobs set title = $1, ad_id = $2, due_date = $3, target_seconds = $4 where id = $5',
        [title, adId, dueDate, targetSeconds, job.id],
      );
      await addEvent(job.id, desk.name, 'jobSaved', `Job saved as ${title}.`);
      return { status: 200, body: jobJson(await requireJob(desk.id, job.id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/duplicate',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      requireWritableJob(job);
      const id = randomUUID();
      await query(
        `insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds,
                           frame_rate, aspect, state, stamp, next_frame_number, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,now())`,
        [
          id,
          desk.id,
          job.client_id,
          `${job.title} copy`,
          job.ad_id,
          isoDateText(job.due_date),
          job.target_seconds,
          job.frame_rate,
          job.aspect,
          newStamp(),
          job.next_frame_number,
        ],
      );
      for (const frame of await readFrames(job.id)) {
        await query(
          `insert into frames (id, job_id, number, position, duration_frames, action_note,
                               audio_note, shot, visual, file_name, width, height, sha256,
                               drawing_kind, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())`,
          [
            randomUUID(),
            id,
            frame.number,
            frame.position,
            frame.duration_frames,
            frame.action_note,
            frame.audio_note,
            frame.shot,
            frame.visual,
            frame.file_name,
            frame.width,
            frame.height,
            frame.sha256,
            frame.drawing_kind,
          ],
        );
      }
      const made = await requireJob(desk.id, id);
      await addEvent(id, desk.name, 'jobDuplicated', `Job duplicated from ${job.title}.`);
      return { status: 201, body: jobJson(made) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/archive',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      requireWritableJob(job);
      await query("update jobs set state = 'archived' where id = $1", [job.id]);
      await addEvent(job.id, desk.name, 'jobArchived', `${job.title} archived.`);
      return { status: 200, body: jobJson(await requireJob(desk.id, job.id)) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/history',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const events = await query<{ at: Date; actor: string; action: string; text: string }>(
        'select at, actor, action, text from job_events where job_id = $1 order by sequence asc',
        [job.id],
      );
      return {
        status: 200,
        body: {
          events: events.map((event) => ({
            at: toInstantText(event.at),
            actor: event.actor,
            action: event.action,
            text: event.text,
          })),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/search',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const wanted = foldForCompare(context.query.get('q') ?? '');
      if (wanted === '') {
        return { status: 200, body: { jobs: [], clients: [], producers: [], total: 0 } };
      }
      const jobs = (
        await query<{ id: string; title: string }>(
          `select j.id, j.title from jobs j join clients c on c.id = j.client_id
            where j.desk_id = $1 and j.state <> 'archived' and c.state <> 'erased'
            order by j.created_at asc, j.id asc`,
          [desk.id],
        )
      ).filter((job) => foldForCompare(job.title).includes(wanted));
      const clients = (
        await query<{ id: string; name: string }>(
          `select id, name from clients where desk_id = $1 and state <> 'erased'
            order by created_at asc, id asc`,
          [desk.id],
        )
      ).filter((client) => foldForCompare(client.name).includes(wanted));
      const producers = (
        await query<{ id: string; name: string; client_id: string }>(
          `select p.id, p.name, p.client_id from producers p join clients c on c.id = p.client_id
            where c.desk_id = $1 and c.state <> 'erased'
            order by p.created_at asc, p.id asc`,
          [desk.id],
        )
      ).filter((producer) => foldForCompare(producer.name).includes(wanted));
      return {
        status: 200,
        body: {
          jobs,
          clients,
          producers: producers.map((producer) => ({
            id: producer.id,
            name: producer.name,
            clientId: producer.client_id,
          })),
          total: jobs.length + clients.length + producers.length,
        },
      };
    },
  },
];
