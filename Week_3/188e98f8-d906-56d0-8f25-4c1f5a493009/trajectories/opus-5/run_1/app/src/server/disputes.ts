/** Disputes, rulings and the ruling notes sent to captains. */

import type { Answer, Dispute, DisputeStatus } from '../shared/model.js';
import { checkText, LIMITS, normaliseText } from '../shared/text.js';
import { isUniqueViolation, one, type Db } from './db.js';
import { conflict, invalidFields } from './errors.js';
import { MailUnreachable, type MailSink } from './mail.js';
import { refuseDisputeUnlessMarked, roundRow } from './rounds.js';

interface DisputeRow {
  id: number;
  answer_id: number;
  team_id: number;
  round: number;
  question: number;
  answer_text: string;
  reason: string;
  status: DisputeStatus;
  raised_at: Date;
  ruled_at: Date | null;
  note: 'queued' | 'sent' | null;
}

const DISPUTE_SELECT = `select d.id, d.answer_id, d.team_id, d.round, d.question, a.text as answer_text,
         d.reason, d.status, d.raised_at, d.ruled_at, d.note
    from disputes d join answers a on a.id = d.answer_id`;

function toDispute(row: DisputeRow): Dispute {
  return {
    id: row.id,
    answer_id: row.answer_id,
    team_id: row.team_id,
    round: row.round,
    question: row.question,
    answer_text: row.answer_text,
    reason: row.reason,
    status: row.status,
    raised_at: row.raised_at.toISOString(),
    ruled_at: row.ruled_at === null ? null : row.ruled_at.toISOString(),
    note: row.note,
  };
}

export async function listDisputes(db: Db, teamId: number | null): Promise<Dispute[]> {
  const result = await db.query<DisputeRow>(
    `${DISPUTE_SELECT} where ($1::int is null or d.team_id = $1) order by d.raised_at asc, d.id asc`,
    [teamId],
  );
  return result.rows.map(toDispute);
}

export async function disputeById(db: Db, id: number): Promise<Dispute | null> {
  const result = await db.query<DisputeRow>(`${DISPUTE_SELECT} where d.id = $1`, [id]);
  const row = result.rows[0];
  return row === undefined ? null : toDispute(row);
}

/**
 * Raise one dispute on a zero-marked current answer of the captain's own team,
 * in the published refusal order.
 */
export async function raiseDispute(db: Db, disputed: Answer, reason: unknown): Promise<Dispute> {
  return db.transaction(async (tx) => {
    const held = await tx.query<{ current: boolean; ruled: number | null }>(
      'select current, ruled from answers where id = $1 for update',
      [disputed.id],
    );
    const answer = one(held);
    const round = await roundRow(tx, disputed.round);
    refuseDisputeUnlessMarked(round.status);
    if (!answer.current) throw conflict('answer_superseded');
    if (answer.ruled !== 0) throw conflict('answer_not_marked_wrong');
    const already = await tx.query<{ id: number }>('select id from disputes where answer_id = $1', [
      disputed.id,
    ]);
    if (already.rows.length > 0) throw conflict('dispute_exists');
    if (typeof reason !== 'string') {
      throw invalidFields({ reason: reason === undefined || reason === null ? 'required' : 'invalid' });
    }
    const verdict = checkText(reason, LIMITS.disputeReason);
    if (verdict !== 'ok') throw invalidFields({ reason: verdict });
    try {
      const raised = await tx.query<{ id: number }>(
        `insert into disputes (answer_id, team_id, round, question, reason, status)
         values ($1, $2, $3, $4, $5, 'raised') returning id`,
        [disputed.id, disputed.team_id, disputed.round, disputed.question, normaliseText(reason)],
      );
      const stored = await tx.query<DisputeRow>(`${DISPUTE_SELECT} where d.id = $1`, [one(raised).id]);
      return toDispute(one(stored));
    } catch (failure) {
      if (isUniqueViolation(failure, 'disputes_one_per_answer')) throw conflict('dispute_exists');
      throw failure;
    }
  });
}

export interface RulingDeps {
  db: Db;
  mail: MailSink;
}

export async function ruleOnDispute(
  deps: RulingDeps,
  id: number,
  ruling: unknown,
): Promise<Dispute> {
  const { db, mail } = deps;
  await db.transaction(async (tx) => {
    const held = await tx.query<{ status: DisputeStatus; answer_id: number }>(
      'select status, answer_id from disputes where id = $1 for update',
      [id],
    );
    const dispute = one(held);
    if (dispute.status !== 'raised') throw conflict('dispute_already_ruled');
    if (ruling !== 'upheld' && ruling !== 'dismissed') {
      throw invalidFields({ ruling: ruling === undefined || ruling === null ? 'required' : 'invalid' });
    }
    await tx.query(
      `update disputes set status = $2, ruled_at = clock_timestamp(), note = 'queued' where id = $1`,
      [id, ruling],
    );
    if (ruling === 'upheld') {
      await tx.query('update answers set ruled = 1 where id = $1', [dispute.answer_id]);
    }
  });

  await sendNote(db, mail, id);
  const ruled = await db.query<DisputeRow>(`${DISPUTE_SELECT} where d.id = $1`, [id]);
  return toDispute(one(ruled));
}

interface NoteRow {
  round: number;
  title: string;
  question: number;
  answer_text: string;
  status: DisputeStatus;
  email: string;
}

const NOTE_SELECT = `select d.round, r.title, d.question, a.text as answer_text, d.status,
         t.captain_email as email
    from disputes d
    join answers a on a.id = d.answer_id
    join rounds r on r.number = d.round
    join teams t on t.id = d.team_id`;

/** The one note a ruling sends. */
function noteOf(row: NoteRow): { subject: string; body: string } {
  return {
    subject: `Ruling on round ${row.round}, question ${row.question}`,
    body: [
      `Round ${row.round}: ${row.title}`,
      `Question: ${row.question}`,
      `Your answer: ${row.answer_text}`,
      `Ruling: ${row.status === 'upheld' ? 'Upheld' : 'Dismissed'}`,
    ].join('\n'),
  };
}

async function sendNote(db: Db, mail: MailSink, id: number): Promise<void> {
  const result = await db.query<NoteRow>(`${NOTE_SELECT} where d.id = $1 and d.note = 'queued'`, [id]);
  const row = result.rows[0];
  if (row === undefined) return;
  const note = noteOf(row);
  try {
    await mail.deliver({ to: row.email, subject: note.subject, body: note.body });
  } catch (failure) {
    if (failure instanceof MailUnreachable) return;
    throw failure;
  }
  await db.query(`update disputes set note = 'sent' where id = $1 and note = 'queued'`, [id]);
}

/** Keep trying queued notes until the mail server accepts them. */
export function startNoteRetries(db: Db, mail: MailSink, everyMs: number): void {
  const timer = setInterval(() => {
    void (async () => {
      const queued = await db.query<{ id: number }>(`select id from disputes where note = 'queued'`);
      for (const row of queued.rows) await sendNote(db, mail, row.id);
    })().catch(() => {
      /* the next turn of the retry tries again */
    });
  }, everyMs);
  timer.unref();
}
