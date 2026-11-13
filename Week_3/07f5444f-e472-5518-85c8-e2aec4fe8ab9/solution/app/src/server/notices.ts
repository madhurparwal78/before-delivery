// Folder notices and return reminders. A message is `sent` only after the SMTP server accepts it;
// until then it is `queued`, and each delivery attempt claims its rows in the database first so
// that several processes sharing the database never send one message twice.

import type pg from "pg";
import { dateLabel, dateTimeLabel, londonDate, londonTimestamp } from "../shared/london.js";
import { config } from "./config.js";
import { pool, rows, type Db } from "./db.js";
import { dueDate, reminderDue } from "./domain/rentals.js";
import { mailUp, sendAll, type Message } from "./mail.js";
import { chairOf, type PersonRow } from "./people.js";
import { loadProgrammes, pad2, type ProgrammeModel } from "./readModel.js";

/** How long a claim is held while its send is in flight, so a process that dies mid-send never blocks it for good. */
const CLAIM_SECONDS = 120;

/** A failed send's claim lapses just before the next sweep, so every sweep retries it. */
const RETRY_SECONDS = config.reminderSweepSeconds - 1;

interface NoticeTarget {
  programme_id: string;
  player_id: string;
}

/** Composes each player's folder notice from the programme as stored now, paired with its target. */
async function folderNoticeMessages(db: Db, targets: NoticeTarget[]): Promise<{ target: NoticeTarget; message: Message }[]> {
  const programmeIds = [...new Set(targets.map((t) => t.programme_id))];
  const models = new Map((await loadProgrammes(db, programmeIds)).map((m) => [m.row.id, m]));
  const players = new Map(
    (await rows<PersonRow>(db, "SELECT * FROM people WHERE id = ANY($1)", [targets.map((t) => t.player_id)])).map((p) => [p.id, p]),
  );
  return targets.flatMap((target) => {
    const model = models.get(target.programme_id);
    const player = players.get(target.player_id);
    return model && player ? [{ target, message: folderNotice(model, player) }] : [];
  });
}

function folderNotice(model: ProgrammeModel, player: PersonRow): Message {
  const parts = model.works.flatMap((work) =>
    work.parts.filter((part) => part.chair_key === player.chair_key).map((part) => ({ work: work.row.title, name: part.name })),
  );
  const chair = chairOf(player, parts[0]?.name ?? null);
  const number = pad2(model.row.number);
  return {
    to: player.email,
    subject: `Your folder is ready: ${model.row.title}`,
    lines: [
      `${player.name}, your folder for Programme ${number} · ${model.row.title} is ready.`,
      `Chair: ${chair?.label ?? ""}`,
      "Parts:",
      ...parts.map((part) => `${part.work} — ${part.name}`),
      `First rehearsal: ${dateTimeLabel(londonTimestamp(model.row.first_rehearsal))} (London time)`,
    ],
  };
}

/**
 * Gives each newly seated player without a notice row for the programme one notice row and one
 * folder notice, inside the caller's transaction. Returns how many were accepted and queued.
 */
export async function noticeSeatedPlayers(
  client: pg.PoolClient,
  programmeId: string,
  playerIds: string[],
): Promise<{ sent: number; queued: number }> {
  const created = await rows<NoticeTarget>(
    client,
    `INSERT INTO notices (programme_id, player_id, status, claimed_until)
     SELECT $1, unnest($2::text[]), 'queued', now() + make_interval(secs => $3)
     ON CONFLICT DO NOTHING RETURNING programme_id, player_id`,
    [programmeId, playerIds, CLAIM_SECONDS],
  );
  const accepted = await deliverNotices(client, created);
  return { sent: accepted, queued: created.length - accepted };
}

async function deliverNotices(db: Db, targets: NoticeTarget[]): Promise<number> {
  const composed = await folderNoticeMessages(db, targets);
  const accepted = await sendAll(composed.map((c) => c.message));
  const sent = composed.filter((_, i) => accepted[i]).map((c) => c.target);
  const failed = composed.filter((_, i) => !accepted[i]).map((c) => c.target);
  if (sent.length > 0) {
    await db.query(
      `UPDATE notices n SET status = 'sent', sent_at = now(), claimed_until = NULL
       FROM unnest($1::text[], $2::text[]) AS s(programme_id, player_id)
       WHERE n.programme_id = s.programme_id AND n.player_id = s.player_id`,
      [sent.map((t) => t.programme_id), sent.map((t) => t.player_id)],
    );
  }
  if (failed.length > 0) {
    await db.query(
      `UPDATE notices n SET claimed_until = now() + make_interval(secs => $3)
       FROM unnest($1::text[], $2::text[]) AS s(programme_id, player_id)
       WHERE n.programme_id = s.programme_id AND n.player_id = s.player_id`,
      [failed.map((t) => t.programme_id), failed.map((t) => t.player_id), RETRY_SECONDS],
    );
  }
  return sent.length;
}

interface ReminderTarget {
  rental_set_id: string;
  assistant_id: string;
}

interface ReminderRow extends ReminderTarget {
  email: string;
  work_title: string;
  publisher: string;
  programme_number: number;
  programme_title: string;
  final_performance: number;
  copies_on_slip: number;
  copies_checked_in: number;
}

function reminderMessage(row: ReminderRow): Message {
  const due = dateLabel(dueDate(londonDate(row.final_performance)));
  return {
    to: row.email,
    subject: `Rental return due ${due}: ${row.work_title} · ${row.publisher}`,
    lines: [
      `Publisher: ${row.publisher}`,
      `Programme ${pad2(row.programme_number)} · ${row.programme_title}`,
      `Copies on slip: ${row.copies_on_slip}`,
      `Copies checked in: ${row.copies_checked_in}`,
      `Due: ${due} at 23:59 (London time)`,
    ],
  };
}

const REMINDER_DETAIL = `
  SELECT r.rental_set_id, r.assistant_id, pe.email, w.title AS work_title, rs.publisher,
         pr.number AS programme_number, pr.title AS programme_title,
         (SELECT max(performs_at) FROM performances WHERE programme_id = pr.id) AS final_performance,
         (SELECT sum(copies) FROM slip_lines WHERE rental_set_id = rs.id)::int AS copies_on_slip,
         (SELECT sum(checked_in) FROM slip_lines WHERE rental_set_id = rs.id)::int AS copies_checked_in
  FROM reminders r
  JOIN people pe ON pe.id = r.assistant_id
  JOIN rental_sets rs ON rs.id = r.rental_set_id
  JOIN works w ON w.id = rs.work_id
  JOIN programmes pr ON pr.id = w.programme_id`;

export async function deliverReminders(targets: ReminderTarget[]): Promise<void> {
  if (targets.length === 0) return;
  const details = await rows<ReminderRow>(
    pool,
    `${REMINDER_DETAIL} WHERE (r.rental_set_id, r.assistant_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [targets.map((t) => t.rental_set_id), targets.map((t) => t.assistant_id)],
  );
  const accepted = await sendAll(details.map(reminderMessage));
  const sent = details.filter((_, i) => accepted[i]);
  const failed = details.filter((_, i) => !accepted[i]);
  if (sent.length > 0) {
    await pool.query(
      `UPDATE reminders r SET status = 'sent', sent_at = now(), claimed_until = NULL
       FROM unnest($1::text[], $2::text[]) AS s(rental_set_id, assistant_id)
       WHERE r.rental_set_id = s.rental_set_id AND r.assistant_id = s.assistant_id`,
      [sent.map((t) => t.rental_set_id), sent.map((t) => t.assistant_id)],
    );
  }
  if (failed.length > 0) {
    await pool.query(
      `UPDATE reminders r SET claimed_until = now() + make_interval(secs => $3)
       FROM unnest($1::text[], $2::text[]) AS s(rental_set_id, assistant_id)
       WHERE r.rental_set_id = s.rental_set_id AND r.assistant_id = s.assistant_id`,
      [failed.map((t) => t.rental_set_id), failed.map((t) => t.assistant_id), RETRY_SECONDS],
    );
  }
}

/**
 * Creates, already claimed by the caller, the reminders that have come due and are not yet recorded:
 * for one new rental set inside its creating transaction, or for every open set in a sweep.
 */
export async function claimNewReminders(db: Db, rentalSetId: string | null): Promise<ReminderTarget[]> {
  const today = londonDate(Date.now());
  const candidates = await rows<{ id: string; status: "requested" | "received" | "in_use"; final_performance: number }>(
    db,
    `SELECT rs.id, rs.status, (SELECT max(performs_at) FROM performances p WHERE p.programme_id = w.programme_id) AS final_performance
     FROM rental_sets rs JOIN works w ON w.id = rs.work_id
     WHERE rs.status IN ('requested', 'received', 'in_use') AND ($1::text IS NULL OR rs.id = $1)
       AND EXISTS (SELECT 1 FROM people pe WHERE pe.role = 'assistant_librarian'
                   AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.rental_set_id = rs.id AND r.assistant_id = pe.id))`,
    [rentalSetId],
  );
  const due = candidates.filter((set) => reminderDue(set.status, dueDate(londonDate(set.final_performance)), today));
  if (due.length === 0) return [];
  return rows<ReminderTarget>(
    db,
    `INSERT INTO reminders (rental_set_id, assistant_id, status, claimed_until)
     SELECT s.id, pe.id, 'queued', now() + make_interval(secs => $2)
     FROM unnest($1::text[]) AS s(id) CROSS JOIN people pe WHERE pe.role = 'assistant_librarian'
     ON CONFLICT DO NOTHING RETURNING rental_set_id, assistant_id`,
    [due.map((set) => set.id), CLAIM_SECONDS],
  );
}

/** Claims every queued message whose earlier claim has lapsed. */
async function claimQueued<T>(table: "reminders" | "notices", keys: string): Promise<T[]> {
  return rows(
    pool,
    `UPDATE ${table} SET claimed_until = now() + make_interval(secs => $1)
     WHERE status = 'queued' AND (claimed_until IS NULL OR claimed_until < now())
     RETURNING ${keys}`,
    [CLAIM_SECONDS],
  );
}

/** Retries only while this process's mail server answers, so an outage never holds claims. */
async function runSweep(): Promise<void> {
  if (!(await mailUp())) return;
  await deliverReminders(await claimNewReminders(pool, null));
  await deliverReminders(await claimQueued<ReminderTarget>("reminders", "rental_set_id, assistant_id"));
  const notices = await claimQueued<NoticeTarget>("notices", "programme_id, player_id");
  await deliverNotices(pool, notices);
}

let running: Promise<void> = Promise.resolve();

/** The reminder sweep: at start, after each rental set is created and every REMINDER_SWEEP_SECONDS. */
function sweep(): Promise<void> {
  running = running.then(runSweep).catch((error: unknown) => {
    console.error("reminder sweep failed", error instanceof Error ? error.message : error);
  });
  return running;
}

export function startSweeping(): void {
  void sweep();
  setInterval(() => void sweep(), config.reminderSweepSeconds * 1000).unref();
}
