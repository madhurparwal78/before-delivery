import { config } from './config';
import { one, query } from './db/pool';
import { TOWNS } from './domain/time';
import { nowSeconds } from './domain/time';
import { newId } from './ids';
import { FileStoreDown, files } from './services/files';
import { MailNotAccepted, sendMail } from './services/mail';
import { renderPdf } from './services/pdf';
import { queueRequestMail } from './store/mailOut';
import { measuresOf } from './store/read';
import type { DossierRow, LabelRow, RequestRow, ResultRow, StyleRowRecord } from './store/rows';
import { dossierHtmlFor } from './api/dossierHtml';

/** Every copy delivers its own pending mail, and a mail not yet accepted is tried again. */
async function deliverMail(now: number): Promise<void> {
  const pending = await query<{ id: string; recipient: string; subject: string; body: string }>(
    `select m.id, m.recipient, m.subject, m.body from mail_outbox m
     left join labels l on l.id = m.label_id
     where m.sent_at is null and m.send_after <= $1 and (l.id is null or l.state = 'open')
     order by m.sort_index limit 20`,
    [now],
  );
  for (const mail of pending) {
    try {
      await sendMail({ to: mail.recipient, subject: mail.subject, body: mail.body });
      await query('update mail_outbox set sent_at = $1 where id = $2', [nowSeconds(), mail.id]);
    } catch (thrown) {
      if (!(thrown instanceof MailNotAccepted)) throw thrown;
    }
  }
}

/** Exactly one reminder per address goes if the request is still unanswered. */
async function sendReminders(now: number): Promise<void> {
  const due = await query<RequestRow & { label_name: string; style_name: string }>(
    `select r.*, l.name as label_name, s.name as style_name from supplier_requests r
     join labels l on l.id = r.label_id join styles s on s.id = r.style_id
     where r.state = 'sent' and r.reminded_at is null and r.answer is null
       and r.sent_at + $1 <= $2 and r.ends_at > $2 and r.token_ended = false and l.state = 'open'`,
    [config.reminderAfterSeconds, now],
  );
  for (const request of due) {
    await query(`update supplier_requests set state = 'reminded', reminded_at = $1 where id = $2`, [
      now,
      request.id,
    ]);
    await queueRequestMail('reminder', {
      labelId: request.label_id,
      labelName: request.label_name,
      styleName: request.style_name,
      contactName: request.contact_name ?? '',
      contactEmail: request.contact_email ?? '',
      language: request.language,
      token: request.token,
      dueDate: request.due_date,
      townName: TOWNS[request.town].name,
      sendAfter: now,
    });
  }
}

async function queueDeletion(objectKey: string, labelId: string | null): Promise<void> {
  await query(
    `insert into file_deletions (id, object_key, label_id) values ($1,$2,$3)
     on conflict (object_key) do nothing`,
    [newId(), objectKey, labelId],
  );
}

/** A closed label is erased only after MinIO has confirmed each deletion. */
async function eraseLabels(now: number): Promise<void> {
  const due = await query<LabelRow>(
    `select * from labels where state = 'closed' and erase_at is not null and erase_at <= $1`,
    [now],
  );
  for (const label of due) {
    await query('update labels set contact_name = null, contact_email = null where id = $1', [label.id]);
    await query('delete from suppliers where label_id = $1', [label.id]);
    await query(`update passports set state = 'withdrawn' where label_id = $1`, [label.id]);
    await query(
      `update published_gtins set withdrawn = true where style_id in (select id from styles where label_id = $1)`,
      [label.id],
    );
    await query('delete from mail_outbox where label_id = $1 and sent_at is null', [label.id]);

    const keys = await query<{ object_key: string }>(
      `select object_key from evidence_files where label_id = $1
       union all select object_key from dossiers where label_id = $1 and object_key is not null`,
      [label.id],
    );
    for (const key of keys) await queueDeletion(key.object_key, label.id);

    const left = await query<{ id: string; object_key: string }>(
      'select id, object_key from file_deletions where label_id = $1 and done = false',
      [label.id],
    );
    let allGone = true;
    for (const deletion of left) {
      try {
        await files.remove(deletion.object_key);
        await query('update file_deletions set done = true where id = $1', [deletion.id]);
      } catch (thrown) {
        if (!(thrown instanceof FileStoreDown)) throw thrown;
        allGone = false;
      }
    }
    if (allGone) {
      await query('delete from evidence_files where label_id = $1', [label.id]);
      await query('update dossiers set object_key = null where label_id = $1', [label.id]);
      await query(
        `update labels set state = 'erased', closed_at = null, erase_at = null where id = $1`,
        [label.id],
      );
    }
  }
}

/** A deleted label's files leave MinIO, retried until confirmed. */
async function runDeletions(): Promise<void> {
  const left = await query<{ id: string; object_key: string }>(
    'select id, object_key from file_deletions where done = false and label_id is null limit 20',
  );
  for (const deletion of left) {
    try {
      await files.remove(deletion.object_key);
      await query('update file_deletions set done = true where id = $1', [deletion.id]);
    } catch (thrown) {
      if (!(thrown instanceof FileStoreDown)) throw thrown;
    }
  }
}

/** The seeded dossier's PDF is made when Gotenberg and MinIO are first reachable. */
async function makeMissingDossierFiles(): Promise<void> {
  const missing = await query<DossierRow>(
    `select d.* from dossiers d join labels l on l.id = d.label_id
     where d.object_key is null and d.state <> 'replaced' and l.state = 'open' limit 3`,
  );
  for (const dossier of missing) {
    const style = await one<StyleRowRecord>('select * from styles where id = $1', [dossier.style_id]);
    const label = await one<LabelRow>('select * from labels where id = $1', [dossier.label_id]);
    const result = await one<ResultRow>('select * from results where id = $1', [dossier.result_id]);
    if (!style || !label || !result) continue;
    try {
      const pdf = await renderPdf(dossierHtmlFor(style, label, result));
      const key = `dossiers/${style.assessor_id}/${dossier.id}.pdf`;
      await files.put(key, pdf, 'application/pdf');
      await query('update dossiers set object_key = $1 where id = $2', [key, dossier.id]);
    } catch {
      return;
    }
  }
}

export function startWork(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    const now = nowSeconds();
    try {
      await sendReminders(now);
      await deliverMail(now);
      await eraseLabels(now);
      await runDeletions();
      await makeMissingDossierFiles();
    } catch (thrown) {
      process.stderr.write(`background work: ${String(thrown instanceof Error ? thrown.message : thrown)}\n`);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 2000).unref();
  void tick();
}

export { measuresOf };
