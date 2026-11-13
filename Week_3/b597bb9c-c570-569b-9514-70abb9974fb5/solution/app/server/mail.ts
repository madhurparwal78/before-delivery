import { timecode } from "../shared/timecode";
import { rateOf } from "../shared/rational";
import type { OutboxItem } from "../shared/types";
import { config } from "./config";
import { one, pool, query, tx, type Db } from "./db";
import { newId } from "./ids";
import { sendMail } from "./smtp";

interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  state: "waiting" | "sent";
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
}

export async function queueMail(db: Db, to: string, subject: string, body: string): Promise<void> {
  await query("INSERT INTO outbox (id, to_email, subject, body) VALUES ($1,$2,$3,$4)", [newId("mail"), to, subject, body], db);
}

export async function enqueueNotifications(
  db: Db,
  personIds: readonly string[],
  projectId: string,
  author: string,
  frame: number,
  body: string,
): Promise<void> {
  for (const personId of personIds) {
    await query("INSERT INTO notifications (person_id, project_id, author_name, frame, body) VALUES ($1,$2,$3,$4,$5)", [personId, projectId, author, frame, body], db);
  }
}

/** Turns each window of notifications that has ended into one grouped message in the outbox. */
async function closeWindows(): Promise<void> {
  const due = await query<{ person_id: string; project_id: string }>(
    `SELECT person_id, project_id FROM notifications WHERE outbox_id IS NULL
      GROUP BY person_id, project_id HAVING min(created_at) <= now() - make_interval(secs => $1)`,
    [config.mailGroupSeconds],
  );
  for (const { person_id, project_id } of due) {
    await tx(async (db) => {
      const notes = await query<{ id: number; author_name: string; frame: number; body: string; created_at: Date }>(
        `SELECT * FROM notifications WHERE person_id = $1 AND project_id = $2 AND outbox_id IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED`,
        [person_id, project_id],
        db,
      );
      const first = notes[0];
      if (!first) return;
      const window = notes.filter((note) => note.created_at.getTime() <= first.created_at.getTime() + config.mailGroupSeconds * 1000);
      const project = await one<{ title: string; frame_rate: string }>("SELECT title, frame_rate FROM projects WHERE id = $1", [project_id], db);
      const person = await one<{ email: string }>("SELECT email FROM people WHERE id = $1", [person_id], db);
      if (!project || !person) return;
      const rate = rateOf(project.frame_rate);
      const lines = window.map((note) => `${note.author_name} at ${timecode(rate, note.frame)}: ${note.body}`);
      const text = `${lines.join("\n")}\n\nOpen the project: ${config.publicUrl}/projects/${project_id}\n`;
      const mailId = newId("mail");
      await db.query("INSERT INTO outbox (id, to_email, subject, body) VALUES ($1,$2,$3,$4)", [mailId, person.email, `Gatecut · ${project.title} · notes for you (${window.length})`, text]);
      await db.query("UPDATE notifications SET outbox_id = $1 WHERE id = ANY($2)", [mailId, window.map((note) => note.id)]);
    });
  }
}

/** Claims the oldest waiting message that nobody is sending, for long enough to try once. */
async function claimNext(): Promise<OutboxRow | undefined> {
  return one<OutboxRow>(
    `UPDATE outbox SET attempts = attempts + 1, claimed_until = now() + interval '30 seconds'
      WHERE id = (SELECT id FROM outbox WHERE state = 'waiting' AND (claimed_until IS NULL OR claimed_until < now())
                  ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
  );
}

/** One delivery attempt per waiting message; a message is marked sent the moment the server accepts it. */
async function deliverOutbox(): Promise<void> {
  for (let mail = await claimNext(); mail; mail = await claimNext()) {
    try {
      await sendMail({ to: mail.to_email, subject: mail.subject, text: mail.body, messageId: mail.id });
    } catch {
      await query("UPDATE outbox SET claimed_until = NULL WHERE id = $1", [mail.id]);
      return;
    }
    await query("UPDATE outbox SET state = 'sent', sent_at = now() WHERE id = $1", [mail.id]);
  }
}

export function startMail(): void {
  setInterval(() => void closeWindows().catch(() => undefined), 1000).unref();
  setInterval(() => void deliverOutbox().catch(() => undefined), config.outboxRetrySeconds * 1000).unref();
}

/** Nudges delivery without waiting for the next retry. */
export function kickOutbox(): void {
  void deliverOutbox().catch(() => undefined);
}

export async function outboxItems(): Promise<OutboxItem[]> {
  const rows = await query<OutboxRow>("SELECT * FROM outbox ORDER BY seq DESC LIMIT 200", [], pool);
  return rows.map((row) => ({
    id: row.id,
    to: row.to_email,
    subject: row.subject,
    state: row.state,
    attempts: row.attempts,
    created_at: row.created_at.toISOString(),
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
  }));
}
