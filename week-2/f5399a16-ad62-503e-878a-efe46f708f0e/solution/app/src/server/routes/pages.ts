// Private pages: the artist's side (send, list, end) and the producer's side (review, sign-off).

import { randomBytes, randomUUID } from 'node:crypto';
import { COPY, fill, LANGUAGES, PRIVATE_COPY, type Language } from '../../shared/copy';
import { clockIn, TOWN_NAMES, TOWN_ZONES, type Town } from '../../shared/time';
import { roundToTenth, secondsToFrames, type FrameRate } from '../../shared/timecode';
import { config } from '../config';
import { one, pool, rows, transaction, type Row, type Runner } from '../db';
import { dueDatePassed, pageEnded, pageEndsAt, parseLength, type PageKind } from '../domain';
import { conflict, invalid, isUuid, limited, notFound, ok, refused, Refusal, route, type Context } from '../http';
import { queueMail } from '../mail';
import { claimEvent, readWindow, retryAfterSeconds } from '../rate';
import { addHistory, assertJobWritable, assertNotArchived, moveJobState, roundedNow, clientState, cutOfJob, framesWithTimecode, instant, JOB_SELECT, languageOf, loadJob, nameMatches, pathNumber, producerOfDesk, type CutFrame } from '../records';
import { getObject, objectKeys, putObject, storeDown, StoreFailure } from '../s3';
import { addressGiven, filled, isMail } from '../validate';
import { drawingAnswer, pictureKind, drawingType } from './board';

const ATTACHMENT_LIMIT = 5_000_000;

function pageJson(page: Row, now: number): Row {
  const prefix = page.kind === 'signOff' ? 's' : 'r';
  return {
    id: page.id,
    producerId: page.producer_id,
    cut: page.cut,
    url: `/${prefix}/${page.token}`,
    state: pageEnded(page as never, now) ? 'ended' : 'open',
    endsAt: instant(page.ends_at),
  };
}

export function pageToken(): string {
  return randomBytes(18).toString('base64url');
}

/** Opens a page; the producer's earlier open page of that kind on this job ends. */
export async function openPage(tx: Runner, kind: PageKind, job: Row, producer: Row, cut: number | null, now: number): Promise<Row> {
  await tx.query(`UPDATE private_pages SET ended_at = $1, ended_by = 'newAddress' WHERE job_id = $2 AND producer_id = $3 AND kind = $4 AND ended_at IS NULL`, [
    new Date(now), job.id, producer.id, kind,
  ]);
  const endsAt = pageEndsAt(kind, job.due_date, producer.town, now);
  const reminderAt = kind === 'review' ? new Date(now + config.reminderAfterSeconds * 1000) : null;
  return (await one(
    tx,
    `INSERT INTO private_pages (id, kind, token, job_id, producer_id, cut, ends_at, reminder_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [randomUUID(), kind, pageToken(), job.id, producer.id, cut, new Date(endsAt), reminderAt, new Date(now)],
  )) as Row;
}

export function reviewMailBody(title: string, address: string, dueDate: string, language: Language): string {
  return `${title}\n\n${config.publicUrl}${address}\n\n${fill(PRIVATE_COPY[language].mailDueLine, { date: dueDate })}\n`;
}

async function sendable(context: Context): Promise<{ producer: Row; cut: Row }> {
  const { body, found, desk } = context;
  if (typeof body.producerId !== 'string' || !body.producerId) throw invalid({ producerId: COPY.typeName });
  if (!Number.isInteger(body.cut)) throw invalid({ cut: COPY.pickCut });
  const producer = await producerOfDesk(pool, body.producerId, desk.id);
  if (producer.client_id !== found.client_id) throw notFound();
  const cut = await cutOfJob(pool, found.id, body.cut);
  assertJobWritable(found);
  return { producer, cut };
}

route('GET', '/api/jobs/:id/reviews', { load: loadJob }, async ({ found, now }) => {
  const pages = await rows(pool, `SELECT * FROM private_pages WHERE job_id = $1 AND kind = 'review' ORDER BY created_at, id`, [found.id]);
  return ok({ reviews: pages.map((page) => pageJson(page, now)) });
});

route('POST', '/api/jobs/:id/reviews', { load: loadJob }, async (context) => {
  const { found, desk, now } = context;
  const { producer, cut } = await sendable(context);
  if (dueDatePassed(found.due_date, producer.town, now)) throw conflict(COPY.duePassed);
  return transaction(async (tx) => {
    const page = await openPage(tx, 'review', found, producer, cut.number, now);
    const language = languageOf(producer);
    const json = pageJson(page, now);
    await queueMail(tx, {
      clientId: found.client_id,
      to: producer.email,
      subject: fill(PRIVATE_COPY[language].mailReviewSubject, { title: found.title }),
      body: reviewMailBody(found.title, json.url, found.due_date, language),
    });
    await moveJobState(tx, found.id, 'inReview');
    await addHistory(tx, found.id, desk.name, 'reviewSent', fill(COPY.reviewReady, { name: producer.name }), now);
    return ok(json, 201);
  });
});

route('GET', '/api/jobs/:id/sign-offs', { load: loadJob }, async ({ found, now }) => {
  const pages = await rows(pool, `SELECT * FROM private_pages WHERE job_id = $1 AND kind = 'signOff' ORDER BY created_at, id`, [found.id]);
  return ok({ signOffs: pages.map((page) => pageJson(page, now)) });
});

route('POST', '/api/jobs/:id/sign-offs', { load: loadJob }, async (context) => {
  const { found, desk, now } = context;
  const { producer, cut } = await sendable(context);
  return transaction(async (tx) => {
    const page = await openPage(tx, 'signOff', found, producer, cut.number, now);
    const json = pageJson(page, now);
    await queueMail(tx, {
      clientId: found.client_id,
      to: producer.email,
      subject: fill(PRIVATE_COPY[languageOf(producer)].signOffHeading, { title: found.title }),
      body: `${found.title}\n\n${config.publicUrl}${json.url}\n`,
    });
    await addHistory(tx, found.id, desk.name, 'signOffSent', fill(COPY.signOffReady, { name: producer.name }), now);
    return ok(json, 201);
  });
});

function pageEnder(path: string, kind: PageKind): void {
  route(
    'POST',
    path,
    {
      body: 'none',
      load: async ({ params, desk }) => {
        if (!isUuid(params.id)) throw notFound();
        const page = await one(pool, `SELECT p.* FROM private_pages p JOIN jobs j ON j.id = p.job_id WHERE p.id = $1 AND p.kind = $2 AND j.desk_id = $3`, [params.id, kind, desk.id]);
        if (!page) throw notFound();
        return page;
      },
    },
    async ({ found, desk, now }) => {
      const page = await one(pool, `UPDATE private_pages SET ended_at = COALESCE(ended_at, $1), ended_by = COALESCE(ended_by, 'artist') WHERE id = $2 RETURNING *`, [new Date(now), found.id]);
      await addHistory(pool, found.job_id, desk.name, 'pageEnded', COPY.pageEnded, now);
      return ok(pageJson(page as Row, now));
    },
  );
}

pageEnder('/api/reviews/:id/end', 'review');
pageEnder('/api/sign-offs/:id/end', 'signOff');

// The producer's side -----------------------------------------------------------------------------

export interface PrivatePage {
  page: Row;
  job: Row;
  producer: Row;
  language: Language;
  town: Town;
}

/** The token's page, ended or not. An unknown token and an erased client answer 404. */
export async function pageByToken(kind: PageKind, token: string | undefined): Promise<PrivatePage> {
  const page = await one(pool, 'SELECT * FROM private_pages WHERE token = $1 AND kind = $2', [token, kind]);
  if (!page) throw notFound();
  const job = (await one(pool, `${JOB_SELECT} WHERE j.id = $1`, [page.job_id])) as Row;
  const producer = (await one(pool, 'SELECT * FROM producers WHERE id = $1', [page.producer_id])) as Row;
  return { page, job, producer, language: languageOf(producer), town: producer.town };
}

export function isPageOpen({ page, job }: PrivatePage, now: number): boolean {
  return !pageEnded(page as never, now) && clientState({ state: job.client_state, closes_at: job.client_closes_at }, now) === 'active';
}

export function loadOpenPage(kind: PageKind) {
  return async ({ params, now }: Context): Promise<PrivatePage> => {
    const found = await pageByToken(kind, params.token);
    if (!isPageOpen(found, now)) {
      throw new Refusal(410, 'pageEnded', PRIVATE_COPY[kind === 'fee' ? 'en' : found.language].ended);
    }
    return found;
  };
}

/** `<time>` followed by the town's phrase, in the page's language. */
function whenText(at: number, language: Language, town: Town): string {
  return `${clockIn(at, TOWN_ZONES[town])} ${PRIVATE_COPY[language].timePhrase[town]}`;
}

function privateFrames(token: string, kind: 'r' | 's', cut: Row): Row[] {
  return framesWithTimecode(cut.frames as CutFrame[], cut.frame_rate as FrameRate).map(({ frame, timecodeIn }) => ({
    number: frame.number,
    position: frame.position,
    durationFrames: frame.durationFrames,
    timecodeIn,
    actionNote: frame.actionNote,
    drawingUrl: frame.fileName ? `/api/${kind}/${token}/frames/${frame.number}/drawing` : null,
  }));
}

function privateNoteJson(note: Row, token: string): Row {
  return {
    id: note.id,
    frame: note.frame,
    x: note.x,
    y: note.y,
    text: note.text,
    suggestedSeconds: note.suggested_seconds,
    suggestedFrames: note.suggested_frames,
    attachmentUrl: note.attachment_id ? `/api/r/${token}/attachments/${note.attachment_id}` : null,
    createdAt: instant(note.created_at),
  };
}

const loadReview = loadOpenPage('review');
const loadSignOff = loadOpenPage('signOff');

route('GET', '/api/r/:token', { auth: 'none', load: loadReview }, async ({ found, params }) => {
  const { page, job, producer, language } = found as PrivatePage;
  const cut = await cutOfJob(pool, job.id, page.cut);
  const notes = await rows(pool, 'SELECT * FROM notes WHERE job_id = $1 AND producer_id = $2 ORDER BY seq', [job.id, producer.id]);
  return ok({
    language,
    jobTitle: job.title,
    cut: cut.number,
    frameRate: cut.frame_rate,
    aspect: job.aspect,
    dueDate: job.due_date,
    endsAt: instant(page.ends_at),
    name: page.typed_name,
    frames: privateFrames(params.token as string, 'r', cut),
    notes: notes.map((note) => privateNoteJson(note, params.token as string)),
  });
});

function drawingRoute(path: string, load: (context: Context) => Promise<PrivatePage>): void {
  route('GET', path, { auth: 'none', load }, async ({ found, params }) => {
    const { page, job } = found as PrivatePage;
    const cut = await cutOfJob(pool, job.id, page.cut);
    const frame = (cut.frames as CutFrame[]).find((row) => row.number === pathNumber(params.number));
    if (!frame?.sha256) throw notFound();
    return drawingAnswer(job.client_id, job.id, frame.sha256, frame.drawingSeed);
  });
}

drawingRoute('/api/r/:token/frames/:number/drawing', loadReview);
drawingRoute('/api/s/:token/frames/:number/drawing', loadSignOff);

function typedLength(language: Language, typed: unknown, rate: FrameRate): { seconds: string; frames: number } {
  const seconds = parseLength(language, typed);
  if (seconds === null) throw invalid({ length: PRIVATE_COPY[language].numberCopy });
  return { seconds, frames: secondsToFrames(seconds, rate) };
}

route('POST', '/api/r/:token/length', { auth: 'none', load: loadReview }, async ({ found, body }) => {
  const { job, language } = found as PrivatePage;
  return ok(typedLength(language, body.length, job.frame_rate));
});

route(
  'POST',
  '/api/r/:token/attachments',
  {
    auth: 'none',
    body: 'multipart',
    fileLimit: ATTACHMENT_LIMIT,
    fileRefusal: async ({ params }) => {
      const page = await one(pool, `SELECT p.language FROM private_pages r JOIN producers p ON p.id = r.producer_id WHERE r.token = $1`, [params.token]);
      const language = LANGUAGES.includes(page?.language) ? (page?.language as Language) : 'en';
      return PRIVATE_COPY[language].bigAttachment;
    },
    load: loadReview,
  },
  async ({ found, file }) => {
    const { job, producer, language } = found as PrivatePage;
    if (!file || !pictureKind(file.bytes)) throw refused(PRIVATE_COPY[language].badAttachment);
    const id = randomUUID();
    const type = drawingType(file.bytes);
    try {
      await putObject(objectKeys(job.client_id, job.id).attachment(id), file.bytes, type);
    } catch (error) {
      if (error instanceof StoreFailure) throw storeDown();
      throw error;
    }
    await pool.query('INSERT INTO attachments (id, job_id, producer_id, content_type) VALUES ($1, $2, $3, $4)', [id, job.id, producer.id, type]);
    return ok({ attachmentId: id }, 201);
  },
);

export async function attachmentAnswer(clientId: string, jobId: string, id: string, type: string) {
  try {
    return { status: 200, bytes: { data: await getObject(objectKeys(clientId, jobId).attachment(id)), type } };
  } catch (error) {
    if (error instanceof StoreFailure) throw storeDown();
    throw error;
  }
}

route('GET', '/api/r/:token/attachments/:attachment', { auth: 'none', load: loadReview }, async ({ found, params }) => {
  const { job, producer } = found as PrivatePage;
  if (!isUuid(params.attachment)) throw notFound();
  const held = await one(pool, 'SELECT * FROM attachments WHERE id = $1 AND job_id = $2 AND producer_id = $3', [params.attachment, job.id, producer.id]);
  if (!held) throw notFound();
  return attachmentAnswer(job.client_id, job.id, held.id, held.content_type);
});

route('POST', '/api/r/:token/notes', { auth: 'none', load: loadReview }, async ({ found, body, params, now }) => {
  const { page, job, producer, language } = found as PrivatePage;
  assertNotArchived(job);
  const copy = PRIVATE_COPY[language];
  const token = params.token as string;
  if (!filled(body.sendKey)) throw invalid({ sendKey: 'Send this page again.' });
  const replay = await one(pool, 'SELECT answer FROM send_keys WHERE page_id = $1 AND send_key = $2', [page.id, body.sendKey]);
  if (replay) return ok(replay.answer);

  const typedName = filled(body.name) ? body.name.trim() : (page.typed_name as string | null);
  if (!typedName) throw invalid({ name: copy.emptyName });
  const asked = Array.isArray(body.notes) ? (body.notes as Record<string, unknown>[]) : [];
  if (!asked.length) throw invalid({ text: copy.emptyNote });
  const cut = await cutOfJob(pool, job.id, page.cut);
  const starts = new Map(framesWithTimecode(cut.frames as CutFrame[], cut.frame_rate).map(({ frame, timecodeIn }) => [frame.number, timecodeIn]));
  const judged = await Promise.all(asked.map(async (note) => {
    if (!filled(note.text)) throw invalid({ text: copy.emptyNote });
    const timecode = starts.get(note.frame as number);
    if (timecode === undefined) throw notFound();
    for (const axis of ['x', 'y'] as const) {
      const value = note[axis];
      if (typeof value !== 'number' || value < 0 || value > 100) throw invalid({ [axis]: 'Place the pin on the frame.' });
    }
    const hasLength = note.suggestedLength !== null && note.suggestedLength !== undefined && note.suggestedLength !== '';
    const length = hasLength ? typedLength(language, note.suggestedLength, job.frame_rate) : null;
    if (note.attachmentId !== null && note.attachmentId !== undefined) {
      if (!isUuid(note.attachmentId)) throw notFound();
      const held = await one(pool, 'SELECT id FROM attachments WHERE id = $1 AND job_id = $2 AND producer_id = $3', [note.attachmentId, job.id, producer.id]);
      if (!held) throw notFound();
    }
    return { note, timecode, length };
  }));

  return transaction(async (tx) => {
    const claimed = await one(tx, `INSERT INTO send_keys (page_id, send_key, answer) VALUES ($1, $2, '{}') ON CONFLICT DO NOTHING RETURNING send_key`, [page.id, body.sendKey]);
    if (!claimed) {
      const first = await one(tx, 'SELECT answer FROM send_keys WHERE page_id = $1 AND send_key = $2', [page.id, body.sendKey]);
      return ok(first?.answer);
    }
    const stored: Row[] = [];
    for (const { note, timecode, length } of judged) {
      stored.push((await one(
        tx,
        `INSERT INTO notes (id, job_id, page_id, producer_id, frame, timecode, x, y, typed_name, state, text, suggested_seconds, suggested_frames, attachment_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11, $12, $13, $14) RETURNING *`,
        [randomUUID(), job.id, page.id, producer.id, note.frame, timecode, roundToTenth(note.x as number), roundToTenth(note.y as number), typedName, note.text, length?.seconds ?? null, length?.frames ?? null, note.attachmentId ?? null, new Date(roundedNow(now))],
      )) as Row);
    }
    await tx.query('UPDATE private_pages SET typed_name = $1 WHERE id = $2', [typedName, page.id]);
    await addHistory(tx, job.id, producer.name, 'noteSent', fill(COPY.noteArrived, { name: producer.name, number: (stored[0] as Row).frame, time: clockIn(now, TOWN_ZONES[producer.town as Town]), town: TOWN_NAMES[producer.town as Town] }), now);
    const answer = { notes: stored.map((note) => privateNoteJson(note, token)) };
    await tx.query('UPDATE send_keys SET answer = $1 WHERE page_id = $2 AND send_key = $3', [JSON.stringify(answer), page.id, body.sendKey]);
    return ok(answer, 201);
  });
});

route(
  'POST',
  '/api/r/:token/new-link',
  {
    auth: 'none',
    rate: async ({ params, rawBody, now }) => {
      const email = addressGiven(rawBody);
      if (email === null) return;
      const held = await readWindow(`link:${email}`, config.reviewLinkRateWindowSeconds, now);
      if (held.count >= 3) {
        const page = await one(pool, `SELECT p.language FROM private_pages r JOIN producers p ON p.id = r.producer_id WHERE r.token = $1`, [params.token]);
        throw limited(PRIVATE_COPY[(page?.language ?? 'en') as Language].linkLimit, retryAfterSeconds(held.retryAt, now));
      }
    },
    load: async ({ params }) => pageByToken('review', params.token),
  },
  async ({ found, body, now }) => {
    const { page, job, language } = found as PrivatePage;
    const answer = ok({ message: PRIVATE_COPY[language].linkAnswer }, 202);
    if (typeof body.email !== 'string' || !isMail(body.email)) throw invalid({ email: PRIVATE_COPY[language].mailField });
    const full = await claimEvent(`link:${body.email.toLowerCase()}`, config.reviewLinkRateWindowSeconds, 3, now);
    if (full) throw limited(PRIVATE_COPY[language].linkLimit, retryAfterSeconds(full.retryAt, now));
    const producer = await one(pool, `SELECT p.* FROM producers p WHERE p.client_id = $1 AND lower(p.email) = $2 LIMIT 1`, [job.client_id, body.email.toLowerCase()]);
    if (!producer || job.client_state !== 'active') return answer;
    await sendNewLinks(producer, page, now);
    return answer;
  },
);

async function sendNewLinks(producer: Row, askedFrom: Row, now: number): Promise<void> {
  await transaction(async (tx) => {
    const open = await rows(tx, `SELECT * FROM private_pages WHERE producer_id = $1 AND kind = 'review' AND ended_at IS NULL AND ends_at > $2`, [producer.id, new Date(now)]);
    const pages = new Map(open.map((page) => [page.id as string, page]));
    if (askedFrom.producer_id === producer.id && askedFrom.ended_by !== 'artist') pages.set(askedFrom.id, askedFrom);
    const addresses: string[] = [];
    let clientId: string | null = null;
    for (const page of pages.values()) {
      const job = (await one(tx, 'SELECT * FROM jobs WHERE id = $1', [page.job_id])) as Row;
      if (dueDatePassed(job.due_date, producer.town, now)) continue;
      clientId = job.client_id;
      const fresh = await openPage(tx, 'review', job, producer, page.cut, now);
      await tx.query('UPDATE private_pages SET typed_name = $1 WHERE id = $2', [page.typed_name, fresh.id]);
      addresses.push(`${config.publicUrl}${pageJson(fresh, now).url}`);
    }
    if (!addresses.length) return;
    await queueMail(tx, {
      clientId,
      to: producer.email,
      subject: PRIVATE_COPY[languageOf(producer)].mailNewLinkSubject,
      body: `${addresses.join('\n')}\n`,
    });
  });
}

// Sign-off ----------------------------------------------------------------------------------------

function signedText(key: 'signed' | 'alreadySigned', at: number, language: Language, town: Town): string {
  return fill(PRIVATE_COPY[language][key], { when: whenText(at, language, town) });
}

route('GET', '/api/s/:token', { auth: 'none', load: loadSignOff }, async ({ found, params }) => {
  const { page, job, language, town } = found as PrivatePage;
  const cut = await cutOfJob(pool, job.id, page.cut);
  return ok({
    language,
    jobTitle: job.title,
    cut: cut.number,
    frameRate: cut.frame_rate,
    endsAt: instant(page.ends_at),
    signedOffAt: instant(cut.signed_off_at),
    signedOffText: cut.signed_off_at ? signedText('signed', cut.signed_off_at.getTime(), language, town) : null,
    frames: privateFrames(params.token as string, 's', cut),
  });
});

route('POST', '/api/s/:token/sign', { auth: 'none', load: loadSignOff }, async ({ found, body, now }) => {
  const { page, job, producer, language, town } = found as PrivatePage;
  const copy = PRIVATE_COPY[language];
  if (!filled(body.name)) throw invalid({ name: copy.emptyName });
  if (!nameMatches(body.name, producer.name)) throw invalid({ name: copy.wrongName });
  assertNotArchived(job);
  return transaction(async (tx) => {
    await tx.query('SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE', [job.id]);
    const cut = await cutOfJob(tx, job.id, page.cut);
    if (cut.signed_off_at) throw conflict(signedText('alreadySigned', cut.signed_off_at.getTime(), language, town));
    const newer = await one(tx, 'SELECT created_at FROM cuts WHERE job_id = $1 AND number > $2 ORDER BY number DESC LIMIT 1', [job.id, cut.number]);
    if (newer) throw conflict(fill(copy.newerCut, { when: whenText((newer.created_at as Date).getTime(), language, town) }));
    const at = roundedNow(now);
    await tx.query('UPDATE cuts SET signed_off_at = $1, signed_off_by = $2 WHERE id = $3', [new Date(at), producer.name, cut.id]);
    await moveJobState(tx, job.id, 'signedOff');
    await addHistory(tx, job.id, producer.name, 'signedOff', fill(COPY.signOffArrived, { number: cut.number, name: producer.name, time: clockIn(at, TOWN_ZONES[town]), town: TOWN_NAMES[town] }), now);
    return ok({ signedOffAt: instant(new Date(at)), signedOffText: signedText('signed', at, language, town) });
  });
});

