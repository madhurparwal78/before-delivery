import type { Chair } from '../../shared/api.js';
import { displayInstant, isoWithLondonOffset } from '../../shared/london.js';
import type { ProgrammeAggregate } from '../data/programmes.js';
import { loadProgrammeAggregates, stringCountOf } from '../data/programmes.js';
import type { Queryable } from '../db/pool.js';
import { isSeated } from '../domain/seating.js';
import { chairOf } from '../domain/sections.js';
import { sendMessage } from './mail.js';

interface SeatablePerson {
  id: string;
  name: string;
  email: string;
  chair_key: string | null;
  chair_section: string | null;
  chair_number: number | null;
  chair_label: string | null;
}

export interface NoticeCounts {
  sent: number;
  queued: number;
}

async function seatedPeople(db: Queryable, aggregate: ProgrammeAggregate): Promise<{ person: SeatablePerson; chair: Chair }[]> {
  const result = await db.query<SeatablePerson>(
    `SELECT id, name, email, chair_key, chair_section, chair_number, chair_label
       FROM people
      WHERE chair_key IS NOT NULL
      ORDER BY chair_key, chair_number`,
  );
  const stringCount = stringCountOf(aggregate.row);
  const chairKeys = new Set(aggregate.works.flatMap((work) => work.parts.map((part) => part.chair_key)));
  return result.rows.flatMap((person) => {
    const chair = chairOf(person);
    if (!chair || !isSeated(chair, stringCount, chairKeys)) return [];
    return [{ person, chair }];
  });
}

function folderNotice(
  aggregate: ProgrammeAggregate,
  person: SeatablePerson,
  chair: Chair,
): { subject: string; body: string } {
  const number = String(aggregate.row.number).padStart(2, '0');
  const partLines = aggregate.works.flatMap((work) =>
    work.parts
      .filter((part) => part.chair_key === chair.key)
      .map((part) => `${work.row.title} \u2014 ${part.name}`),
  );
  const firstRehearsal = displayInstant(isoWithLondonOffset(aggregate.row.first_rehearsal.getTime()));
  return {
    subject: `Your folder is ready: ${aggregate.row.title}`,
    body: [
      `${person.name}, your folder for Programme ${number} \u00b7 ${aggregate.row.title} is ready.`,
      `Chair: ${chair.label}`,
      'Parts:',
      ...partLines,
      `First rehearsal: ${firstRehearsal} (London time)`,
    ].join('\n'),
  };
}

/**
 * Gives every seated player without a notice row one notice row and one folder notice
 * email. A player who already has a row for the programme never gets a second notice.
 */
export async function noticeSeatedPlayers(db: Queryable, aggregate: ProgrammeAggregate): Promise<void> {
  const seated = await seatedPeople(db, aggregate);
  const fresh: { person: SeatablePerson; chair: Chair }[] = [];
  for (const entry of seated) {
    const inserted = await db.query(
      `INSERT INTO notices (programme_id, player_id, chair_label, status)
       VALUES ($1, $2, $3, 'queued')
       ON CONFLICT (programme_id, player_id) DO NOTHING`,
      [aggregate.row.id, entry.person.id, entry.chair.label],
    );
    if (inserted.rowCount === 1) fresh.push(entry);
  }

  let mailReachable = true;
  for (const entry of fresh) {
    if (!mailReachable) break;
    const message = folderNotice(aggregate, entry.person, entry.chair);
    try {
      await sendMessage({ to: entry.person.email, subject: message.subject, body: message.body });
      await db.query(
        `UPDATE notices SET status = 'sent', sent_at = now() WHERE programme_id = $1 AND player_id = $2`,
        [aggregate.row.id, entry.person.id],
      );
    } catch {
      mailReachable = false;
    }
  }
}

export async function noticeCounts(db: Queryable, programmeId: string): Promise<NoticeCounts> {
  const result = await db.query<{ status: string; total: number }>(
    `SELECT status, count(*)::int AS total FROM notices WHERE programme_id = $1 GROUP BY status`,
    [programmeId],
  );
  return {
    sent: result.rows.find((row) => row.status === 'sent')?.total ?? 0,
    queued: result.rows.find((row) => row.status === 'queued')?.total ?? 0,
  };
}

/**
 * Retries every queued folder notice. Rows are claimed with a row lock, so each message is
 * sent at most once even when several server processes sweep at the same time.
 */
export async function retryQueuedNotices(db: Queryable): Promise<void> {
  const queued = await db.query<{ programme_id: string; player_id: string }>(
    `SELECT programme_id, player_id FROM notices WHERE status = 'queued' ORDER BY created_at
       FOR UPDATE SKIP LOCKED`,
  );
  const programmeIds = [...new Set(queued.rows.map((row) => row.programme_id))];
  const aggregates = await loadProgrammeAggregates(db, programmeIds);
  const byId = new Map(aggregates.map((aggregate) => [aggregate.row.id, aggregate]));
  const people = await db.query<SeatablePerson>(
    `SELECT id, name, email, chair_key, chair_section, chair_number, chair_label FROM people WHERE chair_key IS NOT NULL`,
  );
  const peopleById = new Map(people.rows.map((row) => [row.id, row]));

  for (const row of queued.rows) {
    const aggregate = byId.get(row.programme_id);
    const person = peopleById.get(row.player_id);
    const chair = person ? chairOf(person) : null;
    if (!aggregate || !person || !chair) continue;
    const message = folderNotice(aggregate, person, chair);
    try {
      await sendMessage({ to: person.email, subject: message.subject, body: message.body });
    } catch {
      return;
    }
    await db.query(
      `UPDATE notices SET status = 'sent', sent_at = now()
        WHERE programme_id = $1 AND player_id = $2 AND status = 'queued'`,
      [row.programme_id, row.player_id],
    );
  }
}
