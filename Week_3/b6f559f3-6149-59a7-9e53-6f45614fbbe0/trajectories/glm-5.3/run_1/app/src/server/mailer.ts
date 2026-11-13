// Outbox-backed mail: every mail is written in the same transaction as its
// cause, then sent. Failures leave rows queued; a poller retries them.
import net from 'node:net';
import type { Pool } from 'pg';
import type { Config } from './config';

export interface OutboxRow {
  id: number;
  to_addr: string;
  subject: string;
  body: string;
}

// Writes one mail to the outbox. The caller passes its own client so the row
// joins the surrounding transaction.
export async function queueMail(
  client: PoolClient,
  row: { to: string; subject: string; body: string },
): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO outbox (to_addr, subject, body, status, created_at)
     VALUES ($1, $2, $3, 'queued', now()) RETURNING id`,
    [row.to, row.subject, row.body],
  );
  return res.rows[0]!.id;
}

export type PoolClient = import('pg').PoolClient;

// Sends one mail over SMTP. Returns false when the server is unreachable.
export async function sendSmtp(
  cfg: Config,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const fromMatch = cfg.smtp.from.match(/^(.*?)\s*<(.*)>$/);
  const fromAddr = fromMatch?.[2] ?? cfg.smtp.from;
  void fromMatch?.[1];
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: cfg.smtp.host, port: cfg.smtp.port });
    socket.setTimeout(5000);
    let step = 0;
    let buffer = '';
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.on('timeout', fail);
    socket.on('error', fail);
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (!buffer.includes('\n')) return;
      const line = buffer;
      buffer = '';
      const code = parseInt(line.slice(0, 3), 10);
      if (code < 200 || code >= 400) {
        fail();
        return;
      }
      step += 1;
      const commands = [
        `HELO halation.local\r\n`,
        `MAIL FROM:<${fromAddr}>\r\n`,
        `RCPT TO:<${to}>\r\n`,
        `DATA\r\n`,
      ];
      if (step === 1) socket.write(commands[0]);
      else if (step === 2) socket.write(commands[1]);
      else if (step === 3) socket.write(commands[2]);
      else if (step === 4) socket.write(commands[3]);
      else if (step === 5) {
        const text = [
          `From: ${cfg.smtp.from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          body.replace(/^\./gm, '..'),
          `.`,
        ].join('\r\n');
        socket.write(text + '\r\n');
      } else {
        socket.write('QUIT\r\n');
        socket.end();
        resolve(true);
      }
    });
  });
}

// Retries queued rows: each copy claims rows in a transaction before sending,
// so each mail leaves exactly once.
export async function flushOutbox(pool: Pool, cfg: Config, instanceId: string): Promise<void> {
  const claimTag = `${instanceId}-${Date.now()}`;
  const claimed = await pool.query<OutboxRow>(
    `UPDATE outbox SET claimed_by = $1, claimed_at = now()
     WHERE id IN (
       SELECT id FROM outbox WHERE status = 'queued'
       ORDER BY id LIMIT 25 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, to_addr, subject, body`,
    [claimTag],
  );
  for (const row of claimed.rows) {
    const ok = await sendSmtp(cfg, row.to_addr, row.subject, row.body);
    if (ok) {
      await pool.query(`UPDATE outbox SET status = 'sent', sent_at = now(), claimed_by = NULL WHERE id = $1`, [row.id]);
      await pool.query(
        `UPDATE publish_notices SET status = 'sent' WHERE outbox_id = $1`,
        [row.id],
      );
      await pool.query(`UPDATE invite_notices SET status = 'sent' WHERE outbox_id = $1`, [row.id]);
    } else {
      await pool.query(`UPDATE outbox SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`, [row.id]);
    }
  }
}
