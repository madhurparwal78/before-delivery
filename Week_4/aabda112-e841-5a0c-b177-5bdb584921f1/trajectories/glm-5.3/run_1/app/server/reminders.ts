import crypto from 'node:crypto';
import { q, one } from './db.js';
import { settings } from './settings.js';
import { clockNow } from './clock.js';
import { enqueueMail, flushMail, onMailSent } from './mail.js';
import { clinicDateOf, clinicToUtc } from './tz.js';
import { reminderSendMoment } from './routes/patients.js';

// The one place that decides the reminder schedule (see patients.js for the
// moment itself; this module owns the send/miss rules and the pet token).
const REMINDER_PENDING = 'Scheduled';
const REMINDER_SENT = 'Sent';
const REMINDER_MISSED = 'Missed';

function clinicYear(date: Date): string {
  return String(new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone, year: 'numeric' }).format(date));
}

function formatDueDate(dueDateInput: string | Date): string {
  const dueDate: string =
    dueDateInput instanceof Date ? dueDateInput.toISOString().slice(0, 10) : String(dueDateInput);
  const [y, m, d] = dueDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${String(d).padStart(2, '0')} ${new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(dt)} ${y}`;
}

// Process every vaccination whose send moment the clock has reached.
// Called by the background loop and immediately after the grading clock moves.
export async function processReminders(): Promise<void> {
  const now = clockNow();
  const today = clinicDateOf(now);
  const due = await q(
    `select v.*, p.name as pet_name, p.id as patient_id, c.name as client_name, c.email as client_email,
            cl.name as clinic_name, cl.slug as clinic_slug
     from vaccinations v
     join patients p on p.id = v.patient_id
     join clients c on c.id = p.client_id
     join clinics cl on cl.id = v.clinic_id
     where v.reminder = 'Scheduled' and v.sent_at is null`,
    []
  );
  for (const row of due.rows) {
    const dueDateStr = row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date);
    const sendMoment = reminderSendMoment(dueDateStr);
    if (!sendMoment) continue;
    if (today >= dueDateStr) {
      // still unsent on the due date: missed, never sent
      await q(`update vaccinations set reminder = 'Missed' where id = $1`, [row.id]);
      continue;
    }
    if (now >= sendMoment) {
      const token = crypto.randomBytes(24).toString('base64url');
      enqueueMail({
        to: row.client_email ?? row.client_name,
        subject: `${row.pet_name} is due for ${row.vaccine} on ${formatDueDate(dueDateStr)}`,
        text: `Hello ${row.client_name},\n\n${row.pet_name} is due for ${row.vaccine} on ${formatDueDate(dueDateStr)}.\nBook a visit: ${publicUrl()}/book/${row.clinic_slug}?pet=${token}\n`,
        clinicId: row.clinic_id,
        kind: 'reminder',
        vaccinationId: row.id,
        petToken: token,
      } as any);
      await q(`update vaccinations set sent_at = now() where id = $1`, [row.id]);
    }
  }
}

function publicUrl(): string {
  if (settings.appPublicUrl) return settings.appPublicUrl.replace(/\/$/, '');
  return `http://127.0.0.1:${settings.appPublicPort ?? 4173}`;
}

// Once SMTP accepts a reminder, the patient shows Sent.
onMailSent(async (mail) => {
  if ((mail as any).kind !== 'reminder') return;
  const id = (mail as any).vaccinationId;
  if (id) {
    await q(
      `update vaccinations set reminder = 'Sent', pet_token = $1 where id = $2`,
      [(mail as any).petToken, id]
    );
  }
});

export async function reminderLoop(): Promise<void> {
  await flushMail();
}
