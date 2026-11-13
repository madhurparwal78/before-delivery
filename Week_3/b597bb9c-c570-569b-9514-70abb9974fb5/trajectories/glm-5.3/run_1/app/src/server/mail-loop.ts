import type { AppCtx } from './ctx';
import { newHex } from './util';
import { timecode } from '../shared/frames';

/**
 * Mail: grouped mention notifications, the export-finished mail and the
 * outbox sender. A message is marked sent the moment SMTP accepts it and
 * is never sent again; while SMTP is unreachable mail waits in the
 * visible outbox.
 */
export async function processMailWindows(ctx: AppCtx): Promise<void> {
  const closed = await ctx.db.query(
    `SELECT person_id, project_id, window_key FROM mention_windows WHERE closes_at <= now()`,
  );
  for (const win of closed.rows) {
    const notes = await ctx.db.query(
      `SELECT author_name, body, frame FROM notifications
       WHERE person_id = $1 AND project_id = $2 AND window_key = $3 ORDER BY created_at`,
      [win.person_id, win.project_id, win.window_key],
    );
    const project = await ctx.db.query<{ title: string; frame_rate: string }>(
      'SELECT title, frame_rate FROM projects WHERE id = $1',
      [win.project_id],
    );
    const person = await ctx.db.query<{ email: string }>('SELECT email FROM people WHERE id = $1', [win.person_id]);
    if (notes.rows.length > 0 && person.rows[0] !== undefined) {
      const title = project.rows[0]?.title ?? '';
      const rate = project.rows[0]?.frame_rate ?? '25';
      const lines = notes.rows.map(
        (note: { author_name: string; body: string; frame: number }) =>
          `${note.author_name} at ${timecode(Number(note.frame), rate)}: ${note.body}`,
      );
      await ctx.db.query(
        `INSERT INTO outbox (id, workspace_id, to_address, subject, body, state)
         VALUES ($1,$2,$3,$4,$5,'waiting')`,
        [`ob-${newHex(10)}`, ctx.workspaceId, person.rows[0]!.email,
          `Gatecut · ${title} · notes for you (${notes.rows.length})`, lines.join('\n')],
      );
    }
    await ctx.db.query('DELETE FROM notifications WHERE person_id = $1 AND project_id = $2 AND window_key = $3',
      [win.person_id, win.project_id, win.window_key]);
    await ctx.db.query('DELETE FROM mention_windows WHERE person_id = $1 AND project_id = $2 AND window_key = $3',
      [win.person_id, win.project_id, win.window_key]);
  }
}

/** Send waiting outbox messages; each attempt counts and sent mail is final. */
export async function sendOutbox(ctx: AppCtx): Promise<void> {
  if (!ctx.mail.isUp()) return;
  const waiting = await ctx.db.query(
    `SELECT * FROM outbox WHERE state = 'waiting' ORDER BY created_at`,
  );
  for (const message of waiting.rows) {
    try {
      await ctx.mail.send(message.to_address, message.subject, message.body);
      await ctx.db.query(
        `UPDATE outbox SET state = 'sent', sent_at = now() WHERE id = $1`,
        [message.id],
      );
    } catch {
      await ctx.db.query('UPDATE outbox SET attempts = attempts + 1 WHERE id = $1', [message.id]);
    }
  }
}

export function startMailLoop(ctx: AppCtx): void {
  const tick = (): void => {
    void processMailWindows(ctx).catch(() => undefined);
    void sendOutbox(ctx).catch(() => undefined);
  };
  tick();
  setInterval(tick, Math.max(1, ctx.config.outboxRetrySeconds) * 1000);
}
