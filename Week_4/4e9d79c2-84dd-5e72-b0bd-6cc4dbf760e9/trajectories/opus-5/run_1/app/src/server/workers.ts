import { config } from './config.js';
import { query } from './db.js';
import { Pennies } from '../domain/money.js';
import { addDays, ukDateOf, ukTimeOf } from '../domain/time.js';
import { customersToErase, markErasingCustomers } from './data/customers.js';
import { documentsOf, documentObjectKey, storeDocument } from './data/documents.js';
import { loadHire } from './data/hires.js';
import { markExpiryMailed, papersNeedingExpiryMail } from './data/operators.js';
import { mailBalanceReminder, mailPaperExpiry } from './mails.js';
import { documentHtml } from './documents.js';
import { renderPdf } from './providers/pdf.js';
import { deleteObject, putObject, reachStore } from './providers/storage.js';
import { REMINDER_DAYS_BEFORE, BALANCE_DUE_DAYS_BEFORE } from '../domain/payments.js';

const WORKER_GAP_MS = 2000;

async function deskIds(): Promise<{ id: string; email: string }[]> {
  return query<{ id: string; email: string }>('select id, email from desks order by created_at');
}

async function markDone(deskId: string, kind: string, key: string): Promise<boolean> {
  const answer = await query<{ key: string }>(
    'insert into daily_marks (desk_id, kind, key) values ($1,$2,$3) on conflict do nothing returning key',
    [deskId, kind, key],
  );
  return answer.length > 0;
}

/** One mail per paper at the first daily check that finds it ending within 30 days. */
async function paperExpiryMails(deskId: string, deskEmail: string, now: number): Promise<void> {
  for (const paper of await papersNeedingExpiryMail(deskId, now)) {
    await mailPaperExpiry(deskEmail, paper);
    await markExpiryMailed(deskId, paper.operatorId, paper.kind);
  }
}

/** One reminder from 10 days before departure while a balance is owed and more than 7 days remain. */
async function balanceReminders(deskId: string, now: number): Promise<void> {
  const today = ukDateOf(now);
  const rows = await query<{ id: string; depart_date: string }>(
    `select e.id, e.depart_date from enquiries e join hires h on h.desk_id = e.desk_id and h.id = e.id
     where e.desk_id = $1 and h.reminder_sent = false and h.cancelled_at is null and h.stage = 'accepted'`,
    [deskId],
  );
  for (const row of rows) {
    const days = Math.round(
      (new Date(`${row.depart_date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000,
    );
    if (days > REMINDER_DAYS_BEFORE || days <= BALANCE_DUE_DAYS_BEFORE) continue;
    const hire = await loadHire(deskId, row.id);
    if (!hire || hire.owed <= 0) continue;
    const owed: Pennies = hire.owed;
    await mailBalanceReminder(
      hire.customer.email,
      hire.reference,
      owed,
      hire.balanceDueOn ?? row.depart_date,
      hire.page ? `/q/${hire.page.token}` : null,
    );
    await query('update hires set reminder_sent = true where desk_id = $1 and id = $2', [deskId, row.id]);
  }
}

async function dailyCheck(now: number): Promise<void> {
  for (const desk of await deskIds()) {
    const key = config.dailyRunAt === 'any' ? String(now) : ukDateOf(now);
    if (config.dailyRunAt !== 'any' && !(await markDone(desk.id, 'daily', key))) continue;
    try {
      await paperExpiryMails(desk.id, desk.email, now);
      await balanceReminders(desk.id, now);
    } catch (trouble) {
      console.error('daily check', trouble);
    }
  }
}

/** With MinIO down an erasure stays Erasing and never claims to be done. */
async function eraseCheck(now: number): Promise<void> {
  for (const desk of await deskIds()) {
    await markErasingCustomers(desk.id, now);
  }
  for (const customer of await customersToErase(now)) {
    try {
      await reachStore();
      const lists = await query<{ object_key: string }>(
        `select l.object_key from passenger_lists l
         join enquiries e on e.desk_id = l.desk_id and e.id = l.hire_id
         where l.desk_id = $1 and e.customer_id = $2`,
        [customer.deskId, customer.id],
      );
      for (const list of lists) await deleteObject(list.object_key);
      await query(
        `delete from passengers where desk_id = $1 and hire_id in
           (select id from enquiries where desk_id = $1 and customer_id = $2)`,
        [customer.deskId, customer.id],
      );
      await query(
        `delete from passenger_lists where desk_id = $1 and hire_id in
           (select id from enquiries where desk_id = $1 and customer_id = $2)`,
        [customer.deskId, customer.id],
      );
      await query(
        `update quote_pages set replaced = true where desk_id = $1 and hire_id in
           (select id from enquiries where desk_id = $1 and customer_id = $2)`,
        [customer.deskId, customer.id],
      );
      await query(
        `update documents set customer_name = 'Erased customer' where desk_id = $1 and hire_id in
           (select id from enquiries where desk_id = $1 and customer_id = $2)`,
        [customer.deskId, customer.id],
      );
      await query(
        `update customers set erased = true, state = 'erasing', name = 'Erased customer', email = '',
           email_folded = '', telephone = '', telephone_folded = '', notes = ''
         where desk_id = $1 and id = $2`,
        [customer.deskId, customer.id],
      );
    } catch {
      await query("update customers set state = 'erasing' where desk_id = $1 and id = $2", [
        customer.deskId,
        customer.id,
      ]);
    }
  }
}

/** The seeded invoice's PDF is rendered and stored once both providers answer, taking no further number. */
async function pendingDocuments(): Promise<void> {
  for (const desk of await deskIds()) {
    for (const document of await documentsOf(desk.id)) {
      if (document.state === 'stored') continue;
      const hire = await loadHire(desk.id, document.hireId);
      if (!hire) continue;
      try {
        const html = await documentHtml(hire, document.kind, document.number);
        const pdf = await renderPdf(html);
        const objectKey = documentObjectKey(desk.id, document.id);
        await putObject(objectKey, pdf, 'application/pdf');
        await query(
          `update documents set state = 'stored', object_key = $3, history = history || $4::jsonb
           where desk_id = $1 and id = $2`,
          [
            desk.id,
            document.id,
            objectKey,
            JSON.stringify([
              { at: new Date().toISOString().slice(0, 19) + 'Z', who: 'Wayticket', what: 'Stored' },
            ]),
          ],
        );
      } catch {
        return;
      }
    }
  }
}

let running = false;

export function startWorkers(): void {
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      if (config.dailyRunAt === 'any' || ukTimeOf(now).slice(0, 5) === config.dailyRunAt) {
        await dailyCheck(now);
      }
      await eraseCheck(now);
      await pendingDocuments();
    } catch (trouble) {
      console.error('worker', trouble);
    } finally {
      running = false;
    }
  };
  setInterval(() => {
    void tick();
  }, WORKER_GAP_MS).unref();
  void tick();
}

export { addDays, storeDocument };
