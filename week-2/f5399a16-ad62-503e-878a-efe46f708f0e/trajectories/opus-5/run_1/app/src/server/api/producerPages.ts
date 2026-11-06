import { randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { namesMatch } from '../../domain/folding.js';
import { moneyText } from '../../domain/money.js';
import { readImageHeader } from '../../domain/imageHeader.js';
import { privateCopy, whenText } from '../../domain/privateCopy.js';
import type { Language } from '../../domain/privateCopy.js';
import { suggestedLength } from '../../domain/rules.js';
import { framesFromSeconds, timecode } from '../../domain/timecode.js';
import { parseDecimal } from '../../domain/rational.js';
import { clockTimeIn, toInstantText, townLabel } from '../../domain/time.js';
import { ATTACHMENT_LIMIT, config } from '../config.js';
import type { Context, RouteSpec } from '../http.js';
import { readJsonBody, refuse, takeUpload } from '../http.js';
import { one, query } from '../infra/db.js';
import { objectExists, putObject, StoreDown, storeKeys } from '../infra/store.js';
import { newLinkMailBody, queueMail } from '../mail.js';
import { takeHit } from '../rate.js';
import { requireFile } from '../upload.js';
import { FieldCollector } from '../validate.js';
import { readCutFrames, requireCut } from './cuts.js';
import type { CutFrameRow, CutRow } from './cuts.js';
import { drawingReply, readStored } from './drawings.js';
import { letterAmounts, letterPdfReply } from './letters.js';
import type { LetterRow } from './letters.js';
import { pageEndsAt, pageHasEnded } from './pages.js';
import type { PageRow } from './pages.js';
import { addEvent, isoDateText } from './support.js';
import type { JobRow, ProducerRow } from './support.js';

type PageContext = {
  page: PageRow;
  job: JobRow;
  producer: ProducerRow;
  cut: CutRow;
};

const PAGE_QUERIES = {
  review: `select p.* from review_pages p join clients c on c.id =
             (select client_id from jobs where id = p.job_id)
            where p.token = $1 and c.state <> 'erased'`,
  signOff: `select p.* from sign_off_pages p join clients c on c.id =
              (select client_id from jobs where id = p.job_id)
             where p.token = $1 and c.state <> 'erased'`,
} as const;

async function loadPage(
  kind: keyof typeof PAGE_QUERIES,
  token: string,
): Promise<PageContext> {
  const page = await one<PageRow>(PAGE_QUERIES[kind], [token]);
  if (!page) throw refuse.notFound();
  const producer = await one<ProducerRow>('select * from producers where id = $1', [
    page.producer_id,
  ]);
  const job = await one<JobRow>(
    `select j.*, c.name as client_name, c.place as client_place, c.state as client_state
       from jobs j join clients c on c.id = j.client_id where j.id = $1`,
    [page.job_id],
  );
  if (!producer || !job) throw refuse.notFound();
  const cut = await requireCut(job.id, page.cut_number);
  return { page, job, producer, cut };
}

/** A closing client's private pages answer 410, and so does an ended page. */
function requireOpen(held: PageContext): PageContext {
  if (pageHasEnded(held.page) || held.job.client_state !== 'active') {
    throw refuse.pageEnded(privateCopy('ended', held.producer.language));
  }
  return held;
}

function frameJsonFor(
  prefix: string,
  token: string,
  cut: CutRow,
  frames: readonly CutFrameRow[],
): Record<string, unknown>[] {
  let running = 0;
  return frames.map((frame) => {
    const timecodeIn = timecode(running, cut.frame_rate);
    running += frame.duration_frames;
    return {
      number: frame.number,
      position: frame.position,
      durationFrames: frame.duration_frames,
      timecodeIn,
      actionNote: frame.action_note,
      drawingUrl:
        frame.drawing_kind === null
          ? null
          : `/api/${prefix}/${token}/frames/${frame.number}/drawing`,
    };
  });
}

type ProducerNoteRow = {
  id: string;
  frame: number;
  x: string;
  y: string;
  text: string;
  suggested_seconds: string | null;
  attachment_id: string | null;
  created_at: Date;
};

export const producerPageRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/r/:token',
    auth: 'open',
    handler: async (context) => {
      const held = requireOpen(await loadPage('review', context.params['token'] ?? ''));
      const frames = await readCutFrames(held.cut.id);
      const notes = await query<ProducerNoteRow>(
        `select id, frame, x, y, text, suggested_seconds, attachment_id, created_at
           from notes where job_id = $1 and producer_id = $2 order by created_at asc`,
        [held.job.id, held.producer.id],
      );
      return {
        status: 200,
        body: {
          language: held.producer.language,
          jobTitle: held.job.title,
          cut: held.cut.number,
          frameRate: held.cut.frame_rate,
          aspect: held.job.aspect,
          dueDate: isoDateText(held.job.due_date),
          endsAt: toInstantText(held.page.ends_at),
          name: held.page.typed_name ?? null,
          frames: frameJsonFor('r', held.page.token, held.cut, frames),
          notes: notes.map((note) => ({
            id: note.id,
            frame: note.frame,
            x: Number(note.x),
            y: Number(note.y),
            text: note.text,
            suggestedSeconds: note.suggested_seconds,
            suggestedFrames:
              note.suggested_seconds === null
                ? null
                : framesFromSeconds(
                    parseDecimal(note.suggested_seconds, '.') ?? { n: 0n, d: 1n },
                    held.job.frame_rate,
                  ),
            attachmentUrl:
              note.attachment_id === null
                ? null
                : `/api/r/${held.page.token}/attachments/${note.attachment_id}`,
            createdAt: toInstantText(note.created_at),
          })),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/r/:token/frames/:number/drawing',
    auth: 'open',
    handler: async (context) => {
      const held = requireOpen(await loadPage('review', context.params['token'] ?? ''));
      return drawingReply(held.job, await cutFrameOf(held, context.params['number'] ?? ''));
    },
  },
  {
    method: 'POST',
    pattern: '/api/r/:token/length',
    auth: 'open',
    body: 'json',
    handler: async (context) => {
      const held = requireOpen(await loadPage('review', context.params['token'] ?? ''));
      const body = await readJsonBody(context);
      const typed = typeof body['length'] === 'string' ? body['length'] : '';
      const read = suggestedLength(typed, held.producer.language, held.job.frame_rate);
      if (read === null) {
        throw refuse.fields({
          length: privateCopy('numberCopy', held.producer.language),
        });
      }
      return { status: 200, body: { seconds: read.seconds, frames: read.frames } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/r/:token/attachments',
    auth: 'open',
    body: 'upload',
    uploadLimit: async (context) => ({
      bytes: ATTACHMENT_LIMIT,
      message: privateCopy('bigAttachment', await pageLanguage(context)),
    }),
    handler: async (context) => {
      const held = requireOpen(await loadPage('review', context.params['token'] ?? ''));
      const file = requireFile(takeUpload(context), 'file');
      const header = readImageHeader(file.bytes);
      if (header === null) {
        throw refuse.fields({
          file: privateCopy('badAttachment', held.producer.language),
        });
      }
      const id = randomUUID();
      const key = storeKeys.attachment(held.job.client_id, held.job.id, id);
      try {
        await putObject(key, file.bytes, header.contentType);
        if (!(await objectExists(key))) throw new StoreDown('object not confirmed');
      } catch (error) {
        if (error instanceof StoreDown) {
          throw refuse.unavailable(privateCopy('refreshLine', held.producer.language));
        }
        throw error;
      }
      await query(
        `insert into attachments (id, job_id, producer_id, content_type, size, created_at)
         values ($1,$2,$3,$4,$5,now())`,
        [id, held.job.id, held.producer.id, header.contentType, file.bytes.length],
      );
      return { status: 201, body: { attachmentId: id } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/r/:token/attachments/:attachmentId',
    auth: 'open',
    handler: async (context) => {
      const held = requireOpen(await loadPage('review', context.params['token'] ?? ''));
      const attachment = await one<{ id: string; content_type: string }>(
        'select id, content_type from attachments where id = $1 and producer_id = $2',
        [context.params['attachmentId'] ?? '', held.producer.id],
      );
      if (!attachment) throw refuse.notFound();
      const bytes = await readStored(
        storeKeys.attachment(held.job.client_id, held.job.id, attachment.id),
      );
      return { status: 200, bytes, contentType: attachment.content_type };
    },
  },
  {
    method: 'POST',
    pattern: '/api/r/:token/notes',
    auth: 'open',
    body: 'json',
    handler: async (context) => {
      const held = requireOpen(await loadPage('review', context.params['token'] ?? ''));
      const language = held.producer.language;
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const sendKey = fields.text(body, 'sendKey', 'Send the notes again.');
      const name = fields.text(body, 'name', privateCopy('emptyName', language));
      const asked = Array.isArray(body['notes']) ? (body['notes'] as unknown[]) : [];
      if (asked.length === 0) fields.problem('notes', privateCopy('emptyNote', language));
      fields.done();

      const already = await one<{ answer: unknown }>(
        'select answer from note_batches where review_page_id = $1 and send_key = $2',
        [held.page.id, sendKey],
      );
      if (already) return { status: 200, body: already.answer };

      const prepared = asked.map((entry) => readNote(entry, held, language));
      const made: ProducerNoteRow[] = [];
      for (const note of prepared) {
        const id = randomUUID();
        await query(
          `insert into notes (id, job_id, producer_id, review_page_id, frame, x, y, typed_name,
                              state, text, suggested_seconds, attachment_id, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,now())`,
          [
            id,
            held.job.id,
            held.producer.id,
            held.page.id,
            note.frame,
            note.x,
            note.y,
            name,
            note.text,
            note.suggestedSeconds,
            note.attachmentId,
          ],
        );
        const stored = await one<ProducerNoteRow>(
          `select id, frame, x, y, text, suggested_seconds, attachment_id, created_at
             from notes where id = $1`,
          [id],
        );
        if (stored) made.push(stored);
        await addEvent(
          held.job.id,
          held.producer.name,
          'noteSent',
          say.noteArrived(
            held.producer.name,
            note.frame,
            clockTimeIn(new Date(), held.producer.town),
            townLabel(held.producer.town),
          ),
        );
      }
      await query(
        'update review_pages set typed_name = $1, notes_sent_at = now() where id = $2',
        [name, held.page.id],
      );
      const answer = {
        notes: made.map((note) => ({
          id: note.id,
          frame: note.frame,
          x: Number(note.x),
          y: Number(note.y),
          text: note.text,
          suggestedSeconds: note.suggested_seconds,
          suggestedFrames:
            note.suggested_seconds === null
              ? null
              : framesFromSeconds(
                  parseDecimal(note.suggested_seconds, '.') ?? { n: 0n, d: 1n },
                  held.job.frame_rate,
                ),
          attachmentUrl:
            note.attachment_id === null
              ? null
              : `/api/r/${held.page.token}/attachments/${note.attachment_id}`,
          createdAt: toInstantText(note.created_at),
        })),
      };
      await query(
        `insert into note_batches (review_page_id, send_key, answer, created_at)
         values ($1,$2,$3,now())`,
        [held.page.id, sendKey, JSON.stringify(answer)],
      );
      return { status: 201, body: answer };
    },
  },
  {
    method: 'POST',
    pattern: '/api/r/:token/new-link',
    auth: 'open',
    body: 'json',
    limit: async (context) => {
      const body = await peekEmail(context);
      const verdict = await takeHit(
        `new-link:${body}`,
        3,
        config.timers.reviewLinkWindowSeconds,
      );
      if (!verdict.allowed) {
        throw refuse.rateLimited(
          privateCopy('linkLimit', await pageLanguage(context)),
          (verdict.retryAt.getTime() - Date.now()) / 1000,
        );
      }
    },
    handler: async (context) => {
      const page = await one<PageRow>(PAGE_QUERIES.review, [context.params['token'] ?? '']);
      if (!page) throw refuse.notFound();
      const language = await pageLanguage(context);
      const email = String((await readJsonBody(context))['email'] ?? '');
      const producer = await one<ProducerRow>(
        'select * from producers where lower(email) = lower($1)',
        [email],
      );
      if (producer) await sendNewLinks(producer, page);
      return {
        status: 202,
        body: { message: privateCopy('linkAnswer', language) },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/s/:token',
    auth: 'open',
    handler: async (context) => {
      const held = requireOpen(await loadPage('signOff', context.params['token'] ?? ''));
      return {
        status: 200,
        body: {
          language: held.producer.language,
          jobTitle: held.job.title,
          cut: held.cut.number,
          frameRate: held.cut.frame_rate,
          endsAt: toInstantText(held.page.ends_at),
          signedOffAt:
            held.cut.signed_off_at === null ? null : toInstantText(held.cut.signed_off_at),
          signedOffText:
            held.cut.signed_off_at === null
              ? null
              : privateCopy('signed', held.producer.language, {
                  when: whenText(
                    clockTimeIn(held.cut.signed_off_at, held.producer.town),
                    held.producer.town,
                    held.producer.language,
                  ),
                }),
          frames: frameJsonFor('s', held.page.token, held.cut, await readCutFrames(held.cut.id)),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/s/:token/frames/:number/drawing',
    auth: 'open',
    handler: async (context) => {
      const held = requireOpen(await loadPage('signOff', context.params['token'] ?? ''));
      return drawingReply(held.job, await cutFrameOf(held, context.params['number'] ?? ''));
    },
  },
  {
    method: 'POST',
    pattern: '/api/s/:token/sign',
    auth: 'open',
    body: 'json',
    handler: async (context) => {
      const held = requireOpen(await loadPage('signOff', context.params['token'] ?? ''));
      const language = held.producer.language;
      const body = await readJsonBody(context);
      const typed = typeof body['name'] === 'string' ? body['name'] : '';
      if (typed.trim() === '') {
        throw refuse.fields({ name: privateCopy('emptyName', language) });
      }
      // Name is judged before state.
      if (!namesMatch(typed, held.producer.name)) {
        throw refuse.fields({ name: privateCopy('wrongName', language) });
      }
      const newer = await one<{ created_at: Date }>(
        'select created_at from cuts where job_id = $1 and number > $2 order by number asc limit 1',
        [held.job.id, held.cut.number],
      );
      if (newer) {
        throw refuse.state(
          privateCopy('newerCut', language, {
            when: whenText(
              clockTimeIn(newer.created_at, held.producer.town),
              held.producer.town,
              language,
            ),
          }),
        );
      }
      const signed = await query<{ signed_off_at: Date }>(
        `update cuts set signed_off_at = now(), signed_off_by = $1, signed_off_producer_id = $2
          where id = $3 and signed_off_at is null returning signed_off_at`,
        [held.producer.name, held.producer.id, held.cut.id],
      );
      const at = signed[0]?.signed_off_at;
      if (at === undefined) {
        const held2 = await requireCut(held.job.id, held.cut.number);
        throw refuse.state(
          privateCopy('alreadySigned', language, {
            when: whenText(
              clockTimeIn(held2.signed_off_at as Date, held.producer.town),
              held.producer.town,
              language,
            ),
          }),
        );
      }
      await query("update jobs set state = 'signedOff' where id = $1 and state <> 'archived'", [
        held.job.id,
      ]);
      await addEvent(
        held.job.id,
        held.producer.name,
        'signedOff',
        say.signedOffArrived(
          held.cut.number,
          held.producer.name,
          clockTimeIn(at, held.producer.town),
          townLabel(held.producer.town),
        ),
      );
      return {
        status: 200,
        body: {
          signedOffAt: toInstantText(at),
          signedOffText: privateCopy('signed', language, {
            when: whenText(clockTimeIn(at, held.producer.town), held.producer.town, language),
          }),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/f/:token',
    auth: 'open',
    handler: async (context) => {
      const { letter, job } = await loadLetter(context.params['token'] ?? '');
      const amounts = letterAmounts(letter, job);
      return {
        status: 200,
        body: {
          jobTitle: job.title,
          currency: letter.currency,
          feeText: moneyText(amounts.feeMinor, letter.currency),
          taxText: moneyText(amounts.taxMinor, letter.currency),
          totalText: moneyText(amounts.totalMinor, letter.currency),
          milestones: amounts.milestones,
          state: letter.state,
          stamp: letter.stamp,
          endsAt: letter.ends_at === null ? null : toInstantText(letter.ends_at),
          pdfUrl: `/api/f/${letter.token}/pdf`,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/f/:token/pdf',
    auth: 'open',
    handler: async (context) => {
      const { letter, job } = await loadLetter(context.params['token'] ?? '');
      return letterPdfReply(letter, job);
    },
  },
  {
    method: 'POST',
    pattern: '/api/f/:token/accept',
    auth: 'open',
    body: 'json',
    handler: async (context) => {
      const { letter, job, producer } = await loadLetter(context.params['token'] ?? '');
      const body = await readJsonBody(context);
      const typed = typeof body['name'] === 'string' ? body['name'] : '';
      if (typed.trim() === '') throw refuse.fields({ name: privateCopy('emptyName', 'en') });
      if (!namesMatch(typed, producer.name)) {
        throw refuse.fields({ name: privateCopy('wrongName', 'en') });
      }
      if (letter.state === 'accepted') throw refuse.state(COPY.letterAccepted);
      if (body['stamp'] !== letter.stamp) {
        throw refuse.stale(
          say.letterStale(clockTimeIn(letter.changed_at, producer.town), townLabel(producer.town)),
        );
      }
      await query(
        `update letters set state = 'accepted', accepted_name = $1, accepted_at = now(),
                            stamp = $2, changed_at = now() where id = $3`,
        [typed, randomUUID().replace(/-/g, '').slice(0, 24), letter.id],
      );
      await addEvent(job.id, producer.name, 'letterAccepted', say.letterAcceptedBy(producer.name));
      return { status: 200, body: { state: 'accepted' } };
    },
  },
];

async function cutFrameOf(held: PageContext, number: string): Promise<CutFrameRow> {
  const frame = await one<CutFrameRow>(
    'select * from cut_frames where cut_id = $1 and number = $2',
    [held.cut.id, Number(number)],
  );
  if (!frame) throw refuse.notFound();
  return frame;
}

async function loadLetter(token: string): Promise<{
  letter: LetterRow;
  job: JobRow;
  producer: ProducerRow;
}> {
  const letter = await one<LetterRow>('select * from letters where token = $1', [token]);
  if (!letter) throw refuse.notFound();
  const job = await one<JobRow>(
    `select j.*, c.name as client_name, c.place as client_place, c.state as client_state
       from jobs j join clients c on c.id = j.client_id where j.id = $1`,
    [letter.job_id],
  );
  if (!job) throw refuse.notFound();
  const producer = await one<ProducerRow>('select * from producers where id = $1', [
    letter.producer_id,
  ]);
  if (!producer) throw refuse.notFound();
  if (
    job.client_state !== 'active' ||
    (letter.ends_at !== null && letter.ends_at.getTime() <= Date.now())
  ) {
    throw refuse.pageEnded(privateCopy('ended', 'en'));
  }
  return { letter, job, producer };
}

type PreparedNote = {
  frame: number;
  x: number;
  y: number;
  text: string;
  suggestedSeconds: string | null;
  attachmentId: string | null;
};

function readNote(entry: unknown, held: PageContext, language: Language): PreparedNote {
  const note = (entry ?? {}) as Record<string, unknown>;
  const text = typeof note['text'] === 'string' ? note['text'] : '';
  if (text.trim() === '') {
    throw refuse.fields({ text: privateCopy('emptyNote', language) });
  }
  const frame = typeof note['frame'] === 'number' ? note['frame'] : 0;
  const typedLength = note['suggestedLength'];
  let suggestedSeconds: string | null = null;
  if (typeof typedLength === 'string' && typedLength !== '') {
    const read = suggestedLength(typedLength, language, held.job.frame_rate);
    if (read === null) {
      throw refuse.fields({ suggestedLength: privateCopy('numberCopy', language) });
    }
    suggestedSeconds = read.seconds;
  }
  return {
    frame,
    x: clampPercent(note['x']),
    y: clampPercent(note['y']),
    text,
    suggestedSeconds,
    attachmentId: typeof note['attachmentId'] === 'string' ? note['attachmentId'] : null,
  };
}

function clampPercent(value: unknown): number {
  const asNumber = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(100, Math.max(0, asNumber)) * 10) / 10;
}

/**
 * One mail holds a new address for each of that producer's open review pages and
 * for the page it was asked from when that page is theirs. A page the artist
 * ended or whose due date has passed gets none.
 */
async function sendNewLinks(producer: ProducerRow, asked: PageRow): Promise<void> {
  const candidates = await query<PageRow & { client_id: string }>(
    `select p.*, j.client_id from review_pages p
       join jobs j on j.id = p.job_id join clients c on c.id = j.client_id
      where p.producer_id = $1 and c.state = 'active'
        and (p.state = 'open' or p.id = $2)
      order by p.created_at asc`,
    [producer.id, asked.id],
  );
  const paths: string[] = [];
  let clientId: string | null = null;
  for (const page of candidates) {
    if (page.state === 'ended' && page.id !== asked.id) continue;
    const job = await one<JobRow>(
      `select j.*, c.name as client_name, c.place as client_place, c.state as client_state
         from jobs j join clients c on c.id = j.client_id where j.id = $1`,
      [page.job_id],
    );
    if (!job) continue;
    const endsAt = pageEndsAt(job, producer, config.timers.reviewPageSeconds);
    if (endsAt.getTime() <= Date.now()) continue;
    const token = randomUUID().replace(/-/g, '');
    await query("update review_pages set state = 'ended' where id = $1", [page.id]);
    await query(
      `insert into review_pages (id, job_id, producer_id, cut_number, token, state, ends_at,
                                 reminder_at, created_at)
       values ($1,$2,$3,$4,$5,'open',$6,null,now())`,
      [randomUUID(), page.job_id, producer.id, page.cut_number, token, endsAt],
    );
    paths.push(`/r/${token}`);
    clientId = page.client_id;
  }
  if (paths.length === 0) return;
  await queueMail({
    clientId,
    recipient: producer.email,
    subject: privateCopy('mailNewLinkSubject', producer.language),
    body: newLinkMailBody(producer.language, paths),
  });
}

/** The language of the page an address was asked from, for its own copy. */
async function pageLanguage(context: Context): Promise<Language> {
  const row = await one<{ language: Language }>(
    `select pr.language from review_pages p join producers pr on pr.id = p.producer_id
      where p.token = $1`,
    [context.params['token'] ?? ''],
  );
  return row?.language ?? 'en';
}

async function peekEmail(context: Context): Promise<string> {
  return String((await readJsonBody(context))['email'] ?? '').toLowerCase();
}
