import { randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { buildMilestones, CURRENCIES, moneyText, parseFeeMinor } from '../../domain/money.js';
import type { Currency } from '../../domain/money.js';
import { FEE_COPY } from '../../domain/privateCopy.js';
import { clockTimeIn, toInstantText, townLabel } from '../../domain/time.js';
import type { Town } from '../../domain/time.js';
import { config } from '../config.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { PdfServiceDown, renderPdf } from '../infra/gotenberg.js';
import { deleteObject, objectExists, putObject, StoreDown, storeKeys } from '../infra/store.js';
import { publicAddress, queueMail } from '../mail.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { readStored } from './drawings.js';
import { addEvent, newStamp, requireJob, requireProducer, requireWritableJob } from './support.js';
import type { JobRow } from './support.js';

export type LetterRow = {
  id: string;
  job_id: string;
  currency: Currency;
  scope: string;
  fee_minor: string;
  state: string;
  stamp: string;
  changed_at: Date;
  producer_id: string | null;
  token: string | null;
  ends_at: Date | null;
  pdf_stored: boolean;
  accepted_name: string | null;
  accepted_at: Date | null;
};

export function letterAmounts(letter: LetterRow, job: JobRow): {
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  milestones: ReturnType<typeof buildMilestones>['milestones'];
} {
  const feeMinor = Number(letter.fee_minor);
  const { milestones, taxMinor } = buildMilestones(feeMinor, job.client_place, letter.currency);
  return { feeMinor, taxMinor, totalMinor: feeMinor + taxMinor, milestones };
}

export function letterJson(letter: LetterRow, job: JobRow): Record<string, unknown> {
  const amounts = letterAmounts(letter, job);
  return {
    id: letter.id,
    jobId: letter.job_id,
    currency: letter.currency,
    scope: letter.scope,
    feeMinor: amounts.feeMinor,
    taxMinor: amounts.taxMinor,
    totalMinor: amounts.totalMinor,
    feeText: moneyText(amounts.feeMinor, letter.currency),
    taxText: moneyText(amounts.taxMinor, letter.currency),
    totalText: moneyText(amounts.totalMinor, letter.currency),
    milestones: amounts.milestones,
    state: letter.state,
    stamp: letter.stamp,
    producerId: letter.producer_id,
    pageUrl: letter.token === null ? null : `/f/${letter.token}`,
    endsAt: letter.ends_at === null ? null : toInstantText(letter.ends_at),
    pdfUrl: `/api/letters/${letter.id}/pdf`,
  };
}

/** The letter's PDF text holds the same amounts as its screen. */
export function letterHtml(letter: LetterRow, job: JobRow): string {
  const amounts = letterAmounts(letter, job);
  const rows = amounts.milestones
    .map(
      (milestone) =>
        `<tr><td>Milestone ${milestone.number}</td><td>${milestone.amountText}</td><td>${milestone.taxText}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:Georgia,serif;color:#141414;margin:48px}
  h1{font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:.02em}
  table{border-collapse:collapse;margin:24px 0}
  td,th{padding:6px 24px 6px 0;text-align:left;font-variant-numeric:tabular-nums}
  .bar{height:28px;background:#d21f27;width:60%;transform:skewX(-18deg)}
  </style></head><body>
  <div class="bar"></div>
  <h1>Fee letter for ${escapeHtml(job.title)}</h1>
  <p>${escapeHtml(job.client_name)}</p>
  <p>${escapeHtml(letter.scope)}</p>
  <table><tr><th>Item</th><th>Amount</th><th>Tax</th></tr>${rows}
  <tr><td>Fee</td><td>${moneyText(amounts.feeMinor, letter.currency)}</td><td>${moneyText(
    amounts.taxMinor,
    letter.currency,
  )}</td></tr>
  <tr><td>Total</td><td>${moneyText(amounts.totalMinor, letter.currency)}</td><td></td></tr></table>
  <p>Currency ${letter.currency}. No payment is taken on this page.</p>
  </body></html>`;
}

function escapeHtml(text: string): string {
  return text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

/** The PDF is kept only after Gotenberg has answered and MinIO has confirmed. */
export async function storeLetterPdf(letter: LetterRow, job: JobRow): Promise<void> {
  const key = storeKeys.letter(job.client_id, job.id, letter.id);
  let bytes: Buffer;
  try {
    bytes = await renderPdf(letterHtml(letter, job));
  } catch (error) {
    if (error instanceof PdfServiceDown) throw refuse.unavailable(COPY.pdfUnavailable);
    throw error;
  }
  try {
    await putObject(key, bytes, 'application/pdf');
    if (!(await objectExists(key))) throw new StoreDown('object not confirmed');
  } catch (error) {
    if (error instanceof StoreDown) {
      await deleteObject(key).catch(() => undefined);
      throw refuse.unavailable(COPY.storeUnavailable);
    }
    throw error;
  }
  await query('update letters set pdf_stored = true where id = $1', [letter.id]);
}

export async function findLetter(deskId: string, letterId: string): Promise<{
  letter: LetterRow;
  job: JobRow;
}> {
  const letter = await one<LetterRow>(
    `select l.* from letters l join jobs j on j.id = l.job_id
       join clients c on c.id = j.client_id
      where l.id = $1 and j.desk_id = $2 and c.state <> 'erased'`,
    [letterId, deskId],
  );
  if (!letter) throw refuse.notFound();
  return { letter, job: await requireJob(deskId, letter.job_id) };
}

/** A letter with no producer yet prints Amsterdam, otherwise the producer's town. */
export async function letterTown(letter: LetterRow): Promise<Town> {
  if (letter.producer_id === null) return 'amsterdam';
  const row = await one<{ town: Town }>('select town from producers where id = $1', [
    letter.producer_id,
  ]);
  return row?.town ?? 'amsterdam';
}

/** A stamp read before a change answers 412, in the producer's town. */
export async function requireLetterStamp(letter: LetterRow, stamp: unknown): Promise<void> {
  if (stamp === letter.stamp) return;
  const town = await letterTown(letter);
  throw refuse.stale(
    say.letterStale(clockTimeIn(letter.changed_at, town), townLabel(town)),
  );
}

export const letterRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/letter',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const letter = await one<LetterRow>('select * from letters where job_id = $1', [job.id]);
      if (!letter) throw refuse.notFound();
      return { status: 200, body: letterJson(letter, job) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/letter',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const currency = fields.choice(body, 'currency', CURRENCIES);
      const feeMinor = parseFeeMinor(body['fee']);
      if (feeMinor === null) fields.problem('fee', COPY.letterAmount);
      const scope = fields.text(body, 'scope', 'Type what the fee covers.');
      fields.done();
      requireWritableJob(job);
      if (await one('select 1 from letters where job_id = $1', [job.id])) {
        throw refuse.state('This job already has a fee letter.');
      }
      const id = randomUUID();
      await query(
        `insert into letters (id, job_id, currency, scope, fee_minor, state, stamp,
                              changed_at, created_at)
         values ($1,$2,$3,$4,$5,'draft',$6,now(),now())`,
        [id, job.id, currency, scope, feeMinor, newStamp()],
      );
      await addEvent(job.id, desk.name, 'letterSaved', COPY.letterSaved);
      const made = await one<LetterRow>('select * from letters where id = $1', [id]);
      return { status: 201, body: letterJson(made as LetterRow, job) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/letters/:id',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { letter, job } = await findLetter(
        desk.id,
        requireUuidParam(context.params['id'] ?? ''),
      );
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const currency =
        'currency' in body ? fields.choice(body, 'currency', CURRENCIES) : letter.currency;
      let feeMinor = Number(letter.fee_minor);
      if ('fee' in body) {
        const read = parseFeeMinor(body['fee']);
        if (read === null) fields.problem('fee', COPY.letterAmount);
        else feeMinor = read;
      }
      const scope =
        'scope' in body ? fields.text(body, 'scope', 'Type what the fee covers.') : letter.scope;
      fields.done();
      requireWritableJob(job);
      if (letter.state === 'accepted') throw refuse.state(COPY.letterAccepted);
      await requireLetterStamp(letter, body['stamp']);

      const next: LetterRow = { ...letter, currency, scope, fee_minor: String(feeMinor) };
      if (letter.state === 'sent') await storeLetterPdf(next, job);
      await query(
        `update letters set currency = $1, scope = $2, fee_minor = $3, stamp = $4,
                            changed_at = now() where id = $5`,
        [currency, scope, feeMinor, newStamp(), letter.id],
      );
      await addEvent(job.id, desk.name, 'letterSaved', COPY.letterSaved);
      const saved = await one<LetterRow>('select * from letters where id = $1', [letter.id]);
      return { status: 200, body: letterJson(saved as LetterRow, job) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/letters/:id/send',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { letter, job } = await findLetter(
        desk.id,
        requireUuidParam(context.params['id'] ?? ''),
      );
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const producerId = fields.uuid(body, 'producerId');
      fields.done();
      requireWritableJob(job);
      if (letter.state === 'accepted') throw refuse.state(COPY.letterAccepted);
      const producer = await requireProducer(desk.id, producerId);
      if (producer.client_id !== job.client_id) throw refuse.notFound();

      await storeLetterPdf(letter, job);
      const token = randomUUID().replace(/-/g, '');
      const endsAt = new Date(
        Math.floor(Date.now() / 1000) * 1000 + config.timers.feePageSeconds * 1000,
      );
      await query(
        `update letters set state = 'sent', producer_id = $1, token = $2, ends_at = $3,
                            stamp = $4, changed_at = now() where id = $5`,
        [producer.id, token, endsAt, newStamp(), letter.id],
      );
      await queueMail({
        clientId: job.client_id,
        recipient: producer.email,
        subject: FEE_COPY.subject.replace('<title>', job.title),
        body: [
          FEE_COPY.heading.replace('<title>', job.title),
          publicAddress(`/f/${token}`),
        ].join('\n\n'),
      });
      await addEvent(job.id, desk.name, 'letterSent', say.feePageReady(producer.name));
      const sent = await one<LetterRow>('select * from letters where id = $1', [letter.id]);
      return { status: 200, body: letterJson(sent as LetterRow, job) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/letters/:id/end-page',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { letter, job } = await findLetter(
        desk.id,
        requireUuidParam(context.params['id'] ?? ''),
      );
      requireWritableJob(job);
      await query('update letters set ends_at = now() where id = $1', [letter.id]);
      const ended = await one<LetterRow>('select * from letters where id = $1', [letter.id]);
      return { status: 200, body: letterJson(ended as LetterRow, job) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/letters/:id/pdf',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { letter, job } = await findLetter(
        desk.id,
        requireUuidParam(context.params['id'] ?? ''),
      );
      return letterPdfReply(letter, job);
    },
  },
];

export async function letterPdfReply(
  letter: LetterRow,
  job: JobRow,
): Promise<{ status: number; bytes: Buffer; contentType: string }> {
  if (!letter.pdf_stored) await storeLetterPdf(letter, job);
  const bytes = await readStored(storeKeys.letter(job.client_id, job.id, letter.id));
  return { status: 200, bytes, contentType: 'application/pdf' };
}
