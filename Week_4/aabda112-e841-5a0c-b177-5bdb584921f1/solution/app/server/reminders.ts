import { addDays, clinicDate, clinicInstant, dueLabel } from '../shared/clinictime.js';
import { config } from './config.js';
import { now } from './clock.js';
import { type Db, rows, transaction } from './db.js';
import { publish } from './live.js';
import { enqueueMail } from './mail.js';
import { randomToken, sha256 } from './http.js';

/** The send moment: REMINDER_HOUR:00 clinic time, REMINDER_LEAD_DAYS calendar days before the due date. */
function reminderSendAt(dueDate: string): Date {
  return clinicInstant(addDays(dueDate, -config.reminderLeadDays), config.reminderHour, 0)!;
}

/** A vaccination recorded after its send moment has passed is Missed and never sent. */
export function reminderAtCreation(dueDate: string, at: Date): 'Scheduled' | 'Missed' {
  return at.getTime() >= reminderSendAt(dueDate).getTime() ? 'Missed' : 'Scheduled';
}


interface Pending {
  id: string;
  clinic_id: string;
  slug: string;
  vaccine: string;
  due_date: string;
  pet: string;
  client_name: string;
  client_email: string;
  queued: boolean;
}

/**
 * Sends each due reminder once. The send moment passing while the clinic date is still before the due date queues
 * one email (even when the clock jumped past it); an unsent reminder at the due date becomes Missed.
 */
export async function processReminders(): Promise<void> {
  const at = now();
  const today = clinicDate(at);
  await transaction('reminders', async (db) => {
    const pending = await rows<Pending>(
      db,
      `SELECT v.id, p.clinic_id, cl.slug, v.vaccine, to_char(v.due_date, 'YYYY-MM-DD') AS due_date, p.name AS pet,
              c.name AS client_name, c.email AS client_email,
              EXISTS (SELECT 1 FROM mail_outbox o WHERE o.vaccination_id = v.id) AS queued
         FROM vaccinations v JOIN patients p ON p.id = v.patient_id JOIN clients c ON c.id = p.client_id JOIN clinics cl ON cl.id = p.clinic_id
        WHERE v.reminder = 'Scheduled'`,
    );
    for (const r of pending) {
      if (r.queued || at.getTime() < reminderSendAt(r.due_date).getTime()) continue;
      if (today >= r.due_date) {
        await db.query(`UPDATE vaccinations SET reminder = 'Missed' WHERE id = $1`, [r.id]);
      } else {
        await queueReminder(db, r);
      }
      await publish(db, r.clinic_id, { t: 'patients' });
    }
  });
}

async function queueReminder(db: Db, r: Pending): Promise<void> {
  const token = randomToken(24);
  await db.query('INSERT INTO pet_tokens (token_hash, vaccination_id) VALUES ($1, $2)', [sha256(token), r.id]);
  await enqueueMail(db, {
    to: r.client_email,
    subject: `${r.pet} is due for ${r.vaccine} on ${dueLabel(r.due_date)}`,
    body: `Hello ${r.client_name},\n\n${r.pet} is due for ${r.vaccine} on ${dueLabel(r.due_date)}.\n\nBook a visit here:\n${config.baseUrl}/book/${r.slug}?pet=${token}\n`,
    vaccinationId: r.id,
  });
}
