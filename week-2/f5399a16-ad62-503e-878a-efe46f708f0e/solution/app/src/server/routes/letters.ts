import { randomUUID } from 'node:crypto';
import { COPY, FEE_MAIL_SUBJECT, fill, PRIVATE_COPY } from '../../shared/copy';
import { clockIn, TOWN_NAMES, TOWN_ZONES, type Town } from '../../shared/time';
import { config } from '../config';
import { one, pool, transaction, type Row } from '../db';
import { feeToMinor, moneyText, splitFee, type Milestone } from '../domain';
import { escapeHtml, renderPdf } from '../gotenberg';
import { conflict, invalid, isUuid, notFound, ok, route, stale, type Answer, type Context } from '../http';
import { queueMail } from '../mail';
import { addHistory, assertJobWritable, assertNotArchived, instant, jobOfDesk, loadJob, nameMatches, newStamp, producerOfDesk } from '../records';
import { getObject, objectKeys, putObject, storeDown, StoreFailure } from '../s3';
import { filled } from '../validate';
import { loadOpenPage, openPage, type PrivatePage } from './pages';

const CURRENCIES = ['EUR', 'CAD', 'USD'];

const LETTER_SELECT = `SELECT l.*, g.token AS page_token, g.ends_at AS page_ends_at FROM letters l LEFT JOIN private_pages g ON g.id = l.page_id`;

function amounts(letter: Row) {
  const feeMinor = letter.fee_minor as number;
  const taxMinor = letter.tax_minor as number;
  const currency = letter.currency as string;
  return {
    feeText: moneyText(currency, feeMinor),
    taxText: moneyText(currency, taxMinor),
    totalText: moneyText(currency, feeMinor + taxMinor),
    milestones: (letter.milestones as Milestone[]).map((m) => ({
      number: m.number,
      amountMinor: m.amountMinor,
      taxMinor: m.taxMinor,
      amountText: moneyText(currency, m.amountMinor),
      taxText: moneyText(currency, m.taxMinor),
    })),
  };
}

function letterJson(letter: Row): Row {
  const feeMinor = letter.fee_minor as number;
  const taxMinor = letter.tax_minor as number;
  return {
    id: letter.id,
    jobId: letter.job_id,
    currency: letter.currency,
    scope: letter.scope,
    feeMinor,
    taxMinor,
    totalMinor: feeMinor + taxMinor,
    ...amounts(letter),
    state: letter.state,
    stamp: letter.stamp,
    producerId: letter.producer_id,
    pageUrl: letter.page_token ? `/f/${letter.page_token}` : null,
    endsAt: instant(letter.page_ends_at),
    pdfUrl: `/api/letters/${letter.id}/pdf`,
  };
}

const LETTER_CSS = `
@page { size: A4 portrait; margin: 22mm; }
body { font-family: 'Source Serif 4', serif; color: #17171a; font-size: 11pt; font-variant-numeric: tabular-nums; }
h1 { font-family: 'Libre Franklin', sans-serif; font-size: 20pt; text-transform: uppercase; margin: 0 0 8mm; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; margin-top: 8mm; }
th, td { text-align: left; padding: 2mm 3mm; }
td:nth-child(n + 2), th:nth-child(n + 2) { text-align: right; }
tbody tr:nth-child(odd) { background: #efeff0; }
.band { height: 10mm; margin-bottom: 8mm; background: repeating-linear-gradient(108deg, #17171a 0 10mm, #fff 10mm 20mm); }
`;

async function letterPdf(job: Row, letter: Row): Promise<Buffer> {
  const money = amounts(letter);
  const rows = money.milestones.map((m) => `<tr><td>Milestone ${m.number}</td><td>${m.amountText}</td><td>${m.taxText}</td></tr>`).join('');
  return renderPdf(
    LETTER_CSS,
    `<div class="band"></div><h1>${escapeHtml(fill(`Fee letter for <title>`, { title: job.title }))}</h1>
     <p>Noor Bakker Boards</p><p>${escapeHtml(letter.scope)}</p>
     <table><thead><tr><th>Milestone</th><th>Amount</th><th>Tax</th></tr></thead><tbody>${rows}</tbody></table>
     <table><tbody><tr><td>Fee</td><td>${money.feeText}</td></tr><tr><td>Tax</td><td>${money.taxText}</td></tr><tr><td>Total</td><td>${money.totalText}</td></tr></tbody></table>`,
  );
}

/** Gotenberg answers first, then MinIO confirms. Any failure leaves the stored letter as it was. */
async function storeLetterPdf(job: Row, letter: Row): Promise<Buffer> {
  const pdf = await letterPdf(job, letter);
  try {
    await putObject(objectKeys(job.client_id, job.id).feeLetter(letter.id), pdf, 'application/pdf');
  } catch (error) {
    if (error instanceof StoreFailure) throw storeDown();
    throw error;
  }
  return pdf;
}

/** The kept PDF, made when first read for a letter that has none yet. */
async function readLetterPdf(job: Row, letter: Row): Promise<Answer> {
  const fileName = 'fee-letter.pdf';
  if (!letter.pdf_stored) {
    const data = await storeLetterPdf(job, letter);
    await pool.query('UPDATE letters SET pdf_stored = true WHERE id = $1', [letter.id]);
    return { status: 200, bytes: { data, type: 'application/pdf', fileName } };
  }
  try {
    return { status: 200, bytes: { data: await getObject(objectKeys(job.client_id, job.id).feeLetter(letter.id)), type: 'application/pdf', fileName } };
  } catch (error) {
    if (error instanceof StoreFailure) throw storeDown();
    throw error;
  }
}

function readFee(fee: unknown): number {
  const minor = feeToMinor(fee);
  if (minor === null) throw invalid({ fee: COPY.typeAmount });
  return minor;
}

function readCurrency(currency: unknown): string {
  if (typeof currency !== 'string' || !CURRENCIES.includes(currency)) throw invalid({ currency: 'Pick a currency.' });
  return currency;
}

route('GET', '/api/jobs/:id/letter', { load: loadJob }, async ({ found }) => {
  const letter = await one(pool, `${LETTER_SELECT} WHERE l.job_id = $1`, [found.id]);
  if (!letter) throw notFound();
  return ok(letterJson(letter));
});

route('POST', '/api/jobs/:id/letter', { load: loadJob }, async ({ found, body, desk, now }) => {
  const feeMinor = readFee(body.fee);
  const currency = readCurrency(body.currency);
  assertJobWritable(found);
  const { milestones, taxMinor } = splitFee(feeMinor, found.client_place);
  return transaction(async (tx) => {
    const id = randomUUID();
    const row = await one(
      tx,
      `INSERT INTO letters (id, job_id, currency, scope, fee_minor, tax_minor, milestones, state, stamp, stamp_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9) ON CONFLICT (job_id) DO NOTHING RETURNING id`,
      [id, found.id, currency, typeof body.scope === 'string' ? body.scope : '', feeMinor, taxMinor, JSON.stringify(milestones), newStamp(), new Date(now)],
    );
    if (!row) throw conflict(COPY.letterExists);
    await addHistory(tx, found.id, desk.name, 'letterSaved', COPY.letterSaved, now);
    return ok(letterJson((await one(tx, `${LETTER_SELECT} WHERE l.id = $1`, [id])) as Row), 201);
  });
});

async function loadLetter(context: Context): Promise<{ letter: Row; job: Row }> {
  if (!isUuid(context.params.id)) throw notFound();
  const letter = await one(pool, `${LETTER_SELECT} JOIN jobs j ON j.id = l.job_id WHERE l.id = $1 AND j.desk_id = $2`, [context.params.id, context.desk.id]);
  if (!letter) throw notFound();
  return { letter, job: await jobOfDesk(pool, letter.job_id, context.desk.id) };
}

async function staleLetter(letter: Row): Promise<ReturnType<typeof stale>> {
  const producer = letter.producer_id ? await one(pool, 'SELECT town FROM producers WHERE id = $1', [letter.producer_id]) : null;
  const town = (producer?.town ?? 'amsterdam') as Town;
  return stale(fill(COPY.letterStale, { time: clockIn((letter.stamp_at as Date).getTime(), TOWN_ZONES[town]), town: TOWN_NAMES[town] }));
}

route('PATCH', '/api/letters/:id', { load: loadLetter }, async ({ found, body, desk, now }) => {
  const { letter, job } = found as { letter: Row; job: Row };
  const feeMinor = 'fee' in body ? readFee(body.fee) : letter.fee_minor as number;
  const currency = 'currency' in body ? readCurrency(body.currency) : (letter.currency as string);
  if (!filled(body.stamp)) throw invalid({ stamp: COPY.readLetterAgain });
  assertJobWritable(job);
  if (letter.state === 'accepted') throw conflict(COPY.letterLocked);
  if (body.stamp !== letter.stamp) throw await staleLetter(letter);
  const { milestones, taxMinor } = splitFee(feeMinor, job.client_place);
  const scope = typeof body.scope === 'string' ? body.scope : letter.scope;
  const changed = { ...letter, currency, scope, fee_minor: feeMinor, tax_minor: taxMinor, milestones };
  if (letter.state === 'sent') await storeLetterPdf(job, changed);
  const saved = await one(
    pool,
    `UPDATE letters SET currency = $1, scope = $2, fee_minor = $3, tax_minor = $4, milestones = $5, stamp = $6, stamp_at = $7, pdf_stored = $8
     WHERE id = $9 AND stamp = $10 AND state <> 'accepted' RETURNING id`,
    [currency, scope, feeMinor, taxMinor, JSON.stringify(milestones), newStamp(), new Date(now), letter.state === 'sent', letter.id, letter.stamp],
  );
  if (!saved) throw conflict(COPY.letterLocked);
  await addHistory(pool, job.id, desk.name, 'letterSaved', COPY.letterSaved, now);
  return ok(letterJson((await one(pool, `${LETTER_SELECT} WHERE l.id = $1`, [letter.id])) as Row));
});

route('POST', '/api/letters/:id/send', { load: loadLetter }, async ({ found, body, desk, now }) => {
  const { letter, job } = found as { letter: Row; job: Row };
  if (typeof body.producerId !== 'string' || !body.producerId) throw invalid({ producerId: COPY.typeName });
  const producer = await producerOfDesk(pool, body.producerId, desk.id);
  if (producer.client_id !== job.client_id) throw notFound();
  assertJobWritable(job);
  if (letter.state === 'accepted') throw conflict(COPY.letterLocked);
  await storeLetterPdf(job, letter);
  return transaction(async (tx) => {
    const page = await openPage(tx, 'fee', job, producer, null, now);
    const sent = await one(tx, `UPDATE letters SET state = 'sent', producer_id = $1, page_id = $2, pdf_stored = true WHERE id = $3 AND state <> 'accepted' RETURNING id`, [producer.id, page.id, letter.id]);
    if (!sent) throw conflict(COPY.letterLocked);
    await queueMail(tx, {
      clientId: job.client_id,
      to: producer.email,
      subject: fill(FEE_MAIL_SUBJECT, { title: job.title }),
      body: `${job.title}\n\n${config.publicUrl}/f/${page.token}\n`,
    });
    await addHistory(tx, job.id, desk.name, 'letterSent', fill(COPY.feeReady, { name: producer.name }), now);
    return ok(letterJson((await one(tx, `${LETTER_SELECT} WHERE l.id = $1`, [letter.id])) as Row));
  });
});

route('POST', '/api/letters/:id/end-page', { load: loadLetter, body: 'none' }, async ({ found, desk, now }) => {
  const { letter, job } = found as { letter: Row; job: Row };
  await transaction(async (tx) => {
    if (letter.page_id) await tx.query(`UPDATE private_pages SET ended_at = COALESCE(ended_at, $1), ended_by = COALESCE(ended_by, 'artist') WHERE id = $2`, [new Date(now), letter.page_id]);
    await tx.query('UPDATE letters SET page_id = NULL WHERE id = $1', [letter.id]);
    await addHistory(tx, job.id, desk.name, 'pageEnded', COPY.pageEnded, now);
  });
  return ok(letterJson((await one(pool, `${LETTER_SELECT} WHERE l.id = $1`, [letter.id])) as Row));
});

route('GET', '/api/letters/:id/pdf', { load: loadLetter }, async ({ found }) => readLetterPdf(found.job, found.letter));

// The producer's side -----------------------------------------------------------------------------

const loadFee = loadOpenPage('fee');

async function letterOfPage(found: PrivatePage): Promise<Row> {
  return (await one(pool, 'SELECT * FROM letters WHERE job_id = $1', [found.job.id])) as Row;
}

route('GET', '/api/f/:token', { auth: 'none', load: loadFee }, async ({ found, params }) => {
  const letter = await letterOfPage(found);
  const { feeText, taxText, totalText, milestones } = amounts(letter);
  return ok({
    jobTitle: found.job.title,
    currency: letter.currency,
    feeText,
    taxText,
    totalText,
    milestones,
    state: letter.state,
    stamp: letter.stamp,
    endsAt: instant(found.page.ends_at),
    pdfUrl: `/api/f/${params.token}/pdf`,
  });
});

route('GET', '/api/f/:token/pdf', { auth: 'none', load: loadFee }, async ({ found }) => readLetterPdf(found.job, await letterOfPage(found)));

route('POST', '/api/f/:token/accept', { auth: 'none', load: loadFee }, async ({ found, body, now }) => {
  const { job, producer } = found as PrivatePage;
  const copy = PRIVATE_COPY.en;
  if (!filled(body.name)) throw invalid({ name: copy.emptyName });
  if (!nameMatches(body.name, producer.name)) throw invalid({ name: copy.wrongName });
  if (!filled(body.stamp)) throw invalid({ stamp: COPY.readLetterAgain });
  assertNotArchived(job);
  const letter = await letterOfPage(found);
  if (letter.state === 'accepted') throw conflict(COPY.letterLocked);
  if (body.stamp !== letter.stamp) throw await staleLetter(letter);
  await transaction(async (tx) => {
    const accepted = await one(tx, `UPDATE letters SET state = 'accepted', stamp = $1, stamp_at = $2 WHERE id = $3 AND stamp = $4 AND state <> 'accepted' RETURNING id`, [newStamp(), new Date(now), letter.id, letter.stamp]);
    if (!accepted) throw conflict(COPY.letterLocked);
    await addHistory(tx, job.id, producer.name, 'letterAccepted', fill(COPY.letterAccepted, { name: producer.name }), now);
  });
  return ok({ state: 'accepted' });
});
