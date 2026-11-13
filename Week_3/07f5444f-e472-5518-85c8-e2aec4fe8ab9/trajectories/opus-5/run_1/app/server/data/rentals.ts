import type { RentalStatus } from '../../shared/api.js';
import { businessDateOf } from '../../shared/london.js';
import type { Queryable } from '../db/pool.js';

export interface RentalSetRow {
  id: string;
  programme_work_id: string;
  publisher: string;
  status: RentalStatus;
  returned_at: Date | null;
  created_at: Date;
  work_title: string;
  programme_id: string;
  programme_number: number;
  programme_title: string;
}

export interface SlipLineRow {
  rental_set_id: string;
  part_id: string;
  part_name: string;
  copies: number;
  checked_in: number;
  ord: number;
}

export interface ReminderRow {
  rental_set_id: string;
  person_id: string;
  status: 'queued' | 'sent';
  sent_at: Date | null;
}

export interface RentalAggregate {
  row: RentalSetRow;
  finalPerformanceDate: string;
  slip: SlipLineRow[];
  reminders: ReminderRow[];
}

const SET_COLUMNS = `rs.id, rs.programme_work_id, rs.publisher, rs.status, rs.returned_at, rs.created_at,
       cw.title AS work_title, pw.programme_id, p.number AS programme_number, p.title AS programme_title`;

export async function loadRentalAggregates(db: Queryable, ids: string[] | null): Promise<RentalAggregate[]> {
  const sets = ids
    ? await db.query<RentalSetRow>(
        `SELECT ${SET_COLUMNS}
           FROM rental_sets rs
           JOIN programme_works pw ON pw.id = rs.programme_work_id
           JOIN catalogue_works cw ON cw.id = pw.catalogue_work_id
           JOIN programmes p ON p.id = pw.programme_id
          WHERE rs.id = ANY($1::text[])`,
        [ids],
      )
    : await db.query<RentalSetRow>(
        `SELECT ${SET_COLUMNS}
           FROM rental_sets rs
           JOIN programme_works pw ON pw.id = rs.programme_work_id
           JOIN catalogue_works cw ON cw.id = pw.catalogue_work_id
           JOIN programmes p ON p.id = pw.programme_id`,
      );
  if (sets.rows.length === 0) return [];

  const setIds = sets.rows.map((row) => row.id);
  const programmeIds = [...new Set(sets.rows.map((row) => row.programme_id))];
  const [slip, reminders, performances] = await Promise.all([
    db.query<SlipLineRow>(
      `SELECT l.rental_set_id, l.part_id, pt.name AS part_name, l.copies, l.checked_in, l.ord
         FROM rental_slip_lines l
         JOIN parts pt ON pt.id = l.part_id
        WHERE l.rental_set_id = ANY($1::text[])
        ORDER BY l.ord`,
      [setIds],
    ),
    db.query<ReminderRow>(
      `SELECT rental_set_id, person_id, status, sent_at FROM rental_reminders WHERE rental_set_id = ANY($1::text[])`,
      [setIds],
    ),
    db.query<{ programme_id: string; latest: Date }>(
      `SELECT programme_id, max(at) AS latest FROM performances WHERE programme_id = ANY($1::text[]) GROUP BY programme_id`,
      [programmeIds],
    ),
  ]);

  const latestByProgramme = new Map(performances.rows.map((row) => [row.programme_id, row.latest]));
  return sets.rows.map((row) => {
    const latest = latestByProgramme.get(row.programme_id);
    if (!latest) throw new Error(`programme without performances: ${row.programme_id}`);
    return {
      row,
      finalPerformanceDate: businessDateOf(latest.getTime()),
      slip: slip.rows.filter((line) => line.rental_set_id === row.id),
      reminders: reminders.rows.filter((reminder) => reminder.rental_set_id === row.id),
    };
  });
}

export async function loadRentalAggregate(db: Queryable, id: string): Promise<RentalAggregate | null> {
  const [aggregate] = await loadRentalAggregates(db, [id]);
  return aggregate ?? null;
}
