import { query, transaction, withAdvisoryLock } from './db.js';
import {
  dayOptions,
  lockDay,
  markExpired,
  markReleased,
  reRank,
  type OptionWithClient,
} from './data/options.js';
import { findTalentById } from './data/talent.js';
import { queueChallengeOutcome } from './api/options.js';
import { licenceEndsOn, licenceStatus } from './domain/licences.js';
import { licenceReminderEmail } from './emails.js';
import { queueMail } from './services/mail.js';
import { MEDIA_NAMES, TERRITORY_NAMES } from '../shared/format.js';
import { formatIsoDate, parseIsoDate } from '../shared/zone.js';
import type { Media, Territory } from '../shared/types.js';

const SWEEP_LOCK = 814_002;

type DueRow = { id: string; talent_id: string; job_date: string };

/** Holds past their release instant expire, and the options below move up. */
async function expireHolds(nowMs: number): Promise<void> {
  const due = await query<DueRow & { hold_until: Date | null }>(
    `SELECT id, talent_id, job_date, hold_until FROM options
     WHERE state IN ('placed', 'challenged') AND release_at <= $1`,
    [new Date(nowMs)],
  );
  for (const row of due) {
    const reason = row.hold_until && row.hold_until.getTime() <= nowMs ? 'hold_expired' : 'auto_release';
    await transaction(async (tx) => {
      await lockDay(tx, row.talent_id, row.job_date);
      const options = await dayOptions(tx, row.talent_id, row.job_date);
      const option = options.find((candidate) => candidate.id === row.id);
      if (!option || (option.state !== 'placed' && option.state !== 'challenged')) return;
      await markExpired(tx, option.id, reason, nowMs);
      await reRank(tx, option.talent_id, option.job_date);
    });
  }
}

/** A challenge that runs out releases the 1st, promotes the 2nd and emails both clients. */
async function timeoutChallenges(nowMs: number): Promise<void> {
  const due = await query<DueRow>(
    `SELECT id, talent_id, job_date FROM options
     WHERE state = 'challenged' AND challenge_deadline <= $1`,
    [new Date(nowMs)],
  );
  for (const row of due) {
    const talent = await findTalentById(row.talent_id);
    if (!talent) continue;
    await transaction(async (tx) => {
      await lockDay(tx, row.talent_id, row.job_date);
      const options = await dayOptions(tx, row.talent_id, row.job_date);
      const option = options.find((candidate) => candidate.id === row.id);
      if (!option || option.state !== 'challenged') return;
      const challenger: OptionWithClient | null = option.challenged_by_option_id
        ? options.find((candidate) => candidate.id === option.challenged_by_option_id) ?? null
        : null;
      await queueChallengeOutcome(tx, {
        talent,
        date: option.job_date,
        firstOption: option,
        challengerOption: challenger,
        event: 'timeout',
      });
      await markReleased(tx, option.id, 'challenge_timeout', nowMs);
      await reRank(tx, option.talent_id, option.job_date);
    });
  }
}

type LicenceReminderRow = {
  id: string;
  first_use_date: string;
  term_months: number;
  extra_months: number;
  media: Media;
  territory: Territory;
  client_contact_email: string;
  client_time_zone: string;
  talent_id: string;
  talent_display_name: string;
};

/** One renewal reminder per licence per end date. */
async function licenceReminders(nowMs: number): Promise<void> {
  const rows = await query<LicenceReminderRow>(
    `SELECT l.id, l.first_use_date, l.term_months, l.extra_months, l.media, l.territory,
            c.contact_email AS client_contact_email, c.time_zone AS client_time_zone,
            t.id AS talent_id, t.display_name AS talent_display_name
     FROM licences l
     JOIN clients c ON c.id = l.client_id
     JOIN talent t ON t.id = l.talent_id`,
  );
  for (const row of rows) {
    const firstUse = parseIsoDate(row.first_use_date);
    if (!firstUse) continue;
    const endsOn = licenceEndsOn(firstUse, row.term_months + row.extra_months);
    if (licenceStatus(endsOn, row.client_time_zone, nowMs) !== 'expiring') continue;
    const endsOnText = formatIsoDate(endsOn);
    // The claim and the message are written together, so a reminder is never lost.
    await transaction(async (tx) => {
      const claimed = await tx.query<{ licence_id: string }>(
        `INSERT INTO licence_reminders (licence_id, ends_on) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING licence_id`,
        [row.id, endsOnText],
      );
      if (claimed.length === 0) return;
      await queueMail(
        licenceReminderEmail({
          recipient: row.client_contact_email,
          talentName: row.talent_display_name,
          endsOn: endsOnText,
          media: MEDIA_NAMES[row.media],
          territory: TERRITORY_NAMES[row.territory],
          talentId: row.talent_id,
          dedupeKey: `licence:${row.id}:${endsOnText}`,
        }),
        tx,
      );
    });
  }
}

/** Every copy runs the sweep; each effect happens exactly once. */
export async function runSweep(nowMs: number): Promise<void> {
  await withAdvisoryLock(SWEEP_LOCK, async () => {
    await expireHolds(nowMs);
    await timeoutChallenges(nowMs);
    await licenceReminders(nowMs);
  });
}
