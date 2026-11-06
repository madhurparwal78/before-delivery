import { privateCopy } from '../domain/privateCopy.js';
import type { Language } from '../domain/privateCopy.js';
import { query } from './infra/db.js';
import { deleteObject, StoreDown, storeKeys } from './infra/store.js';
import { sendMail } from './infra/smtp.js';
import { isoDateText } from './api/support.js';
import { pollRenders } from './api/renders.js';
import { queueMail, reviewMailBody } from './mail.js';

type MailRow = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  attachments: { fileName: string; contentType: string; body: string }[];
};

/** Each copy delivers its own pending mail, each message once. */
async function deliverMail(): Promise<void> {
  const waiting = await query<MailRow>(
    `select m.id, m.recipient, m.subject, m.body, m.attachments from mail_queue m
       left join clients c on c.id = m.client_id
      where m.sent_at is null and m.send_after <= now() and m.tries < 20
        and (m.client_id is null or c.state = 'active')
      order by m.created_at asc limit 5`,
    [],
  );
  for (const mail of waiting) {
    const claimed = await query(
      'update mail_queue set tries = tries + 1 where id = $1 and sent_at is null returning id',
      [mail.id],
    );
    if (claimed.length === 0) continue;
    try {
      await sendMail({
        to: mail.recipient,
        subject: mail.subject,
        text: mail.body,
        attachments: mail.attachments,
      });
      await query('update mail_queue set sent_at = now() where id = $1', [mail.id]);
    } catch {
      // The next pass tries again.
    }
  }
}

/** Closing the page still removes the frame: the server ends the window. */
async function settleRemovals(): Promise<void> {
  const ended = await query<{ id: string; job_id: string; frame_number: number }>(
    `select id, job_id, frame_number from removals
      where settled_at is null and ends_at <= now()`,
    [],
  );
  for (const removal of ended) {
    await query('delete from frames where job_id = $1 and number = $2 and removed_at is not null', [
      removal.job_id,
      removal.frame_number,
    ]);
    await query('update removals set settled_at = now() where id = $1', [removal.id]);
  }
}

/** One reminder goes out only if no note was sent and the page is still open. */
async function sendReminders(): Promise<void> {
  const due = await query<{
    id: string;
    token: string;
    title: string;
    due_date: Date;
    client_id: string;
    email: string;
    language: Language;
  }>(
    `select p.id, p.token, j.title, j.due_date, j.client_id, pr.email, pr.language
       from review_pages p
       join jobs j on j.id = p.job_id
       join clients c on c.id = j.client_id
       join producers pr on pr.id = p.producer_id
      where p.state = 'open' and p.ends_at > now() and p.notes_sent_at is null
        and p.reminder_at is not null and p.reminder_at <= now() and p.reminder_sent_at is null
        and c.state = 'active'`,
    [],
  );
  for (const page of due) {
    const claimed = await query(
      'update review_pages set reminder_sent_at = now() where id = $1 and reminder_sent_at is null returning id',
      [page.id],
    );
    if (claimed.length === 0) continue;
    await queueMail({
      clientId: page.client_id,
      recipient: page.email,
      subject: privateCopy('mailReminderSubject', page.language, { title: page.title }),
      body: reviewMailBody(
        page.language,
        page.title,
        page.token,
        isoDateText(page.due_date),
      ),
    });
  }
}

/**
 * The wait ends exactly at `closesAt`: from that instant the client reads
 * `erasing` or `erased`. Erasure always asks MinIO first, and the client becomes
 * `erased` only after MinIO has confirmed each deletion.
 */
async function eraseClients(): Promise<void> {
  await query(
    `update clients set state = 'erasing'
      where state = 'closing' and closes_at is not null and closes_at <= now()`,
    [],
  );
  const erasing = await query<{ id: string }>(
    "select id from clients where state = 'erasing'",
    [],
  );
  for (const client of erasing) {
    try {
      await eraseOne(client.id);
    } catch (error) {
      if (!(error instanceof StoreDown)) throw error;
    }
  }
}

async function eraseOne(clientId: string): Promise<void> {
  const jobs = await query<{ id: string }>('select id from jobs where client_id = $1', [clientId]);
  for (const job of jobs) {
    const frames = await query<{ sha256: string }>(
      'select distinct sha256 from frames where job_id = $1 and sha256 is not null',
      [job.id],
    );
    const cutFrames = await query<{ sha256: string }>(
      `select distinct f.sha256 from cut_frames f join cuts c on c.id = f.cut_id
        where c.job_id = $1 and f.sha256 is not null`,
      [job.id],
    );
    for (const sha of new Set([...frames, ...cutFrames].map((row) => row.sha256))) {
      await deleteObject(storeKeys.frame(clientId, job.id, sha));
    }
    for (const attachment of await query<{ id: string }>(
      'select id from attachments where job_id = $1',
      [job.id],
    )) {
      await deleteObject(storeKeys.attachment(clientId, job.id, attachment.id));
    }
    for (const render of await query<{ id: string }>('select id from renders where job_id = $1', [
      job.id,
    ])) {
      await deleteObject(storeKeys.film(clientId, job.id, render.id));
    }
    for (const held of await query<{ id: string; file_name: string }>(
      `select p.id, f.file_name from packages p join package_files f on f.package_id = p.id
        where p.job_id = $1`,
      [job.id],
    )) {
      await deleteObject(storeKeys.packageFile(clientId, job.id, held.id, held.file_name));
    }
    for (const letter of await query<{ id: string }>('select id from letters where job_id = $1', [
      job.id,
    ])) {
      await deleteObject(storeKeys.letter(clientId, job.id, letter.id));
    }
  }
  await query('delete from mail_queue where client_id = $1', [clientId]);
  await query('delete from jobs where client_id = $1', [clientId]);
  await query('delete from producers where client_id = $1', [clientId]);
  await query(
    "update clients set state = 'erased', erased_at = now(), closes_at = null where id = $1",
    [clientId],
  );
}

function repeat(work: () => Promise<void>, everyMs: number): void {
  const run = async (): Promise<void> => {
    try {
      await work();
    } catch {
      // The next pass tries again.
    }
    setTimeout(() => void run(), everyMs);
  };
  setTimeout(() => void run(), everyMs);
}

export function startWorkers(): void {
  repeat(deliverMail, 1000);
  repeat(settleRemovals, 1000);
  repeat(pollRenders, 2000);
  repeat(sendReminders, 2000);
  repeat(eraseClients, 2000);
}
