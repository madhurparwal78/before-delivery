import { randomBytes, randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { privateCopy } from '../../domain/privateCopy.js';
import { endOfDayIn, toInstantText } from '../../domain/time.js';
import { config } from '../config.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { queueMail, reviewMailBody, signOffMailBody } from '../mail.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { requireCut } from './cuts.js';
import {
  addEvent,
  isoDateText,
  requireJob,
  requireProducer,
  requireWritableJob,
  setJobState,
} from './support.js';
import type { JobRow, ProducerRow } from './support.js';

export type PageRow = {
  id: string;
  job_id: string;
  producer_id: string;
  cut_number: number;
  token: string;
  state: string;
  ends_at: Date;
  created_at: Date;
  typed_name?: string | null;
};

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * A page lasts until 23:59:59 producer local wall time on the due date, or its
 * own window after sending, whichever comes first.
 */
export function pageEndsAt(job: JobRow, producer: ProducerRow, windowSeconds: number): Date {
  const dueEnd = endOfDayIn(isoDateText(job.due_date), producer.town);
  const window = new Date(Math.floor(Date.now() / 1000) * 1000 + windowSeconds * 1000);
  return dueEnd.getTime() < window.getTime() ? dueEnd : window;
}

export function pageJson(page: PageRow, prefix: 'r' | 's'): Record<string, unknown> {
  return {
    id: page.id,
    producerId: page.producer_id,
    cut: page.cut_number,
    url: `/${prefix}/${page.token}`,
    state: page.state,
    endsAt: toInstantText(page.ends_at),
  };
}

/** A page ends at its instant, by a new address or by the artist. */
export function pageHasEnded(page: PageRow): boolean {
  return page.state === 'ended' || page.ends_at.getTime() <= Date.now();
}

async function readBody(
  context: Parameters<RouteSpec['handler']>[0],
  job: JobRow,
): Promise<{ producer: ProducerRow; cutNumber: number }> {
  const { desk } = requireIdentity(context);
  const body = await readJsonBody(context);
  const fields = new FieldCollector();
  const producerId = fields.uuid(body, 'producerId');
  const cutNumber = fields.wholeNumber(body, 'cut', 1, 10_000_000);
  fields.done();
  const producer = await requireProducer(desk.id, producerId);
  if (producer.client_id !== job.client_id) throw refuse.notFound();
  await requireCut(job.id, cutNumber);
  return { producer, cutNumber };
}

export const pageRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/reviews',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const pages = await query<PageRow>(
        'select * from review_pages where job_id = $1 order by created_at asc',
        [job.id],
      );
      return {
        status: 200,
        body: {
          reviews: pages.map((page) =>
            pageJson({ ...page, state: pageHasEnded(page) ? 'ended' : 'open' }, 'r'),
          ),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/reviews',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = requireWritableJob(
        await requireJob(desk.id, requireUuidParam(context.params['id'] ?? '')),
      );
      const { producer, cutNumber } = await readBody(context, job);
      const endsAt = pageEndsAt(job, producer, config.timers.reviewPageSeconds);
      if (endsAt.getTime() <= Date.now()) throw refuse.state(COPY.dueDatePassed);

      await query(
        `update review_pages set state = 'ended' where job_id = $1 and producer_id = $2
           and state = 'open'`,
        [job.id, producer.id],
      );
      const id = randomUUID();
      const token = newToken();
      await query(
        `insert into review_pages (id, job_id, producer_id, cut_number, token, state, ends_at,
                                   reminder_at, created_at)
         values ($1,$2,$3,$4,$5,'open',$6,$7,now())`,
        [
          id,
          job.id,
          producer.id,
          cutNumber,
          token,
          endsAt,
          new Date(Date.now() + config.timers.reminderAfterSeconds * 1000),
        ],
      );
      await queueMail({
        clientId: job.client_id,
        recipient: producer.email,
        subject: privateCopy('mailReviewSubject', producer.language, { title: job.title }),
        body: reviewMailBody(
          producer.language,
          job.title,
          token,
          isoDateText(job.due_date),
        ),
      });
      await setJobState(job, 'inReview');
      await addEvent(job.id, desk.name, 'reviewSent', say.reviewReady(producer.name));
      const made = await one<PageRow>('select * from review_pages where id = $1', [id]);
      return { status: 201, body: pageJson(made as PageRow, 'r') };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reviews/:id/end',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const page = await one<PageRow>(
        `select p.* from review_pages p join jobs j on j.id = p.job_id
           join clients c on c.id = j.client_id
          where p.id = $1 and j.desk_id = $2 and c.state <> 'erased'`,
        [requireUuidParam(context.params['id'] ?? ''), desk.id],
      );
      if (!page) throw refuse.notFound();
      await query("update review_pages set state = 'ended' where id = $1", [page.id]);
      return { status: 200, body: pageJson({ ...page, state: 'ended' }, 'r') };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/sign-offs',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const pages = await query<PageRow>(
        'select * from sign_off_pages where job_id = $1 order by created_at asc',
        [job.id],
      );
      return {
        status: 200,
        body: {
          signOffs: pages.map((page) =>
            pageJson({ ...page, state: pageHasEnded(page) ? 'ended' : 'open' }, 's'),
          ),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/sign-offs',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = requireWritableJob(
        await requireJob(desk.id, requireUuidParam(context.params['id'] ?? '')),
      );
      const { producer, cutNumber } = await readBody(context, job);
      const endsAt = pageEndsAt(job, producer, config.timers.signOffPageSeconds);
      if (endsAt.getTime() <= Date.now()) throw refuse.state(COPY.dueDatePassed);

      await query(
        `update sign_off_pages set state = 'ended' where job_id = $1 and producer_id = $2
           and state = 'open'`,
        [job.id, producer.id],
      );
      const id = randomUUID();
      const token = newToken();
      await query(
        `insert into sign_off_pages (id, job_id, producer_id, cut_number, token, state, ends_at,
                                     created_at)
         values ($1,$2,$3,$4,$5,'open',$6,now())`,
        [id, job.id, producer.id, cutNumber, token, endsAt],
      );
      await queueMail({
        clientId: job.client_id,
        recipient: producer.email,
        subject: privateCopy('signOffHeading', producer.language, { title: job.title }),
        body: signOffMailBody(
          producer.language,
          job.title,
          token,
          isoDateText(job.due_date),
        ),
      });
      await addEvent(job.id, desk.name, 'signOffSent', say.signOffReady(producer.name));
      const made = await one<PageRow>('select * from sign_off_pages where id = $1', [id]);
      return { status: 201, body: pageJson(made as PageRow, 's') };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sign-offs/:id/end',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const page = await one<PageRow>(
        `select p.* from sign_off_pages p join jobs j on j.id = p.job_id
           join clients c on c.id = j.client_id
          where p.id = $1 and j.desk_id = $2 and c.state <> 'erased'`,
        [requireUuidParam(context.params['id'] ?? ''), desk.id],
      );
      if (!page) throw refuse.notFound();
      await query("update sign_off_pages set state = 'ended' where id = $1", [page.id]);
      return { status: 200, body: pageJson({ ...page, state: 'ended' }, 's') };
    },
  },
];
