/**
 * The letters the desk sends. Each is queued in the database so a copy delivers
 * its own pending mail, and queued mail for an erased client is dropped.
 */
import type { App } from '../app.ts';
import { cFill, c } from '../../shared/clientCopy.ts';
import { formatDate } from '../../shared/dates.ts';
import type { Language } from '../../shared/language.ts';
import { isoWeekday, parseDate, type Town } from '../domain/time.ts';
import { headerSafe } from '../services/mail.ts';
import { CONSERVATOR_ENQUIRY_ADDRESS } from '../config.ts';
import type { Row } from '../present.ts';

export interface ClientPageLetter {
  clientId: string;
  recipient: string;
  language: Language;
  clientName: string;
  pieceTitle: string;
  /** The piece's due date, printed on the client's local date. */
  dueDate: string;
  town: Town;
  address: string;
  reminder: boolean;
}

/**
 * The client's own language, the address and the due date in local wall time.
 * It never carries a labour rate or another client's name.
 */
export async function queueClientPageLetter(app: App, letter: ClientPageLetter): Promise<void> {
  const due = parseDate(letter.dueDate);
  const subject = cFill(letter.reminder ? 'M2' : 'M1', letter.language, {
    title: letter.pieceTitle,
  });
  const body = [
    cFill('M3', letter.language, { name: letter.clientName }),
    '',
    cFill('M4', letter.language, { address: letter.address }),
    '',
    due
      ? cFill('C19', letter.language, {
          date: formatDate({ ...due, weekday: isoWeekday(due) }, letter.language),
        })
      : '',
  ].join('\n');

  await app.db.query(
    `INSERT INTO outbox (client_id, recipient, subject, body) VALUES ($1,$2,$3,$4)`,
    [letter.clientId, letter.recipient, headerSafe(subject), body],
  );
}

export interface EnquiryLetter {
  name: string;
  email: string;
  message: string;
}

/** Reaches the conservator, with each run of line breaks in a name as a space. */
export async function queueEnquiryLetter(app: App, letter: EnquiryLetter): Promise<void> {
  const name = headerSafe(letter.name);
  await app.db.query(
    `INSERT INTO outbox (recipient, subject, body, reply_to) VALUES ($1,$2,$3,$4)`,
    [
      CONSERVATOR_ENQUIRY_ADDRESS,
      `Enquiry from ${name}`,
      [`Name: ${name}`, `Address: ${letter.email}`, '', letter.message].join('\n'),
      letter.email,
    ],
  );
}

/** Delivers what is pending, dropping anything queued for an erased client. */
export async function deliverPending(app: App): Promise<void> {
  const rows = await app.db.query<Row>(
    `SELECT o.* FROM outbox o WHERE o.state = 'pending' ORDER BY o.id LIMIT 20`,
  );
  for (const row of rows) {
    if (row.client_id !== null) {
      const client = await app.db.one<Row>(`SELECT state FROM clients WHERE id = $1`, [
        row.client_id,
      ]);
      if (!client || client.state === 'erasing' || client.state === 'erased') {
        await app.db.query(`UPDATE outbox SET state = 'dropped' WHERE id = $1`, [row.id]);
        continue;
      }
    }
    const claimed = await app.db.one<Row>(
      `UPDATE outbox SET state = 'sending' WHERE id = $1 AND state = 'pending' RETURNING id`,
      [row.id],
    );
    if (!claimed) continue;
    try {
      await app.mail.send({
        to: String(row.recipient),
        subject: String(row.subject),
        body: String(row.body),
        replyTo: row.reply_to === null ? undefined : String(row.reply_to),
      });
      await app.db.query(`UPDATE outbox SET state = 'sent' WHERE id = $1`, [row.id]);
    } catch {
      await app.db.query(`UPDATE outbox SET state = 'pending' WHERE id = $1`, [row.id]);
      return;
    }
  }
}

/**
 * One reminder goes REMINDER_AFTER_SECONDS after sending, and only if no answer
 * and no sign-off came and the page is still live.
 */
export async function sendDueReminders(app: App): Promise<void> {
  const after = app.config.timers.reminderAfterSeconds * 1000;
  const rows = await app.db.query<Row>(
    `SELECT cp.*, p.title, p.due_date, p.client_id, c.name AS client_name, c.town,
            c.language, c.email, c.state AS client_state
       FROM client_pages cp
       JOIN pieces p ON p.id = cp.piece_id
       JOIN clients c ON c.id = p.client_id
      WHERE cp.state = 'live' AND cp.reminder_at IS NULL AND cp.answered_at IS NULL`,
  );
  for (const row of rows) {
    if (row.client_state !== 'active') continue;
    const sentAt = new Date(row.sent_at as string).getTime();
    const endsAt = new Date(row.ends_at as string).getTime();
    if (app.now() < sentAt + after) continue;
    if (app.now() >= endsAt) continue;

    const signed = await app.db.one<Row>(
      `SELECT id FROM estimates WHERE piece_id = $1 AND state = 'signedOff' LIMIT 1`,
      [row.piece_id],
    );
    if (signed) continue;

    const claimed = await app.db.one<Row>(
      `UPDATE client_pages SET reminder_at = now() WHERE id = $1 AND reminder_at IS NULL RETURNING id`,
      [row.id],
    );
    if (!claimed) continue;

    const base = app.config.publicUrl ? app.config.publicUrl.replace(/\/+$/, '') : '';
    await queueClientPageLetter(app, {
      clientId: String(row.client_id),
      recipient: String(row.email),
      language: String(row.language) as Language,
      clientName: String(row.client_name),
      pieceTitle: String(row.title),
      dueDate: String(row.due_date),
      town: String(row.town) as Town,
      address: `${base}/c/${String(row.token)}`,
      reminder: true,
    });
  }
}

export { c };
