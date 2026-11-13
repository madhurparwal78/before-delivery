import { config } from './config.js';
import { query, transaction } from './db.js';
import { sendOverSmtp } from './smtp.js';

export type MailOutcome = 'sent' | 'retrying';

interface Letter {
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
}

export function verificationLetter(email: string, token: string): Letter {
  return {
    recipient: email,
    subject: 'Verify your Strikeproof account',
    body: [
      'Welcome to Strikeproof.',
      '',
      `Verify: ${config.appPublicUrl}/verify/${token}`,
      '',
      'The link works once.',
      '',
      'Holloway Carriage Co.',
    ].join('\n'),
  };
}

export function resetLetter(email: string, token: string): Letter {
  return {
    recipient: email,
    subject: 'Reset your Strikeproof password',
    body: [
      'A password reset was requested for your Strikeproof account.',
      '',
      `Reset: ${config.appPublicUrl}/reset/${token}`,
      '',
      'The link works once.',
      '',
      'Holloway Carriage Co.',
    ].join('\n'),
  };
}

async function deliver(letter: Letter): Promise<void> {
  await sendOverSmtp(
    { host: config.smtpHost, port: config.smtpPort, timeoutMs: 5000 },
    {
      from: config.mailFrom,
      to: letter.recipient,
      subject: letter.subject,
      text: letter.body,
    },
  );
}

/** Keeps the letter in PostgreSQL, sends it now, and leaves it for the retry loop on failure. */
export async function send(letter: Letter): Promise<MailOutcome> {
  const rows = await query<{ id: string }>(
    'insert into pending_mail (recipient, subject, body) values ($1, $2, $3) returning id',
    [letter.recipient, letter.subject, letter.body],
  );
  const id = rows[0]?.id;
  try {
    await deliver(letter);
    await query('update pending_mail set sent_at = now(), attempts = attempts + 1 where id = $1', [
      id,
    ]);
    return 'sent';
  } catch {
    await query('update pending_mail set attempts = attempts + 1 where id = $1', [id]);
    return 'retrying';
  }
}

async function retryPending(): Promise<void> {
  await transaction(async (client) => {
    const pending = await client.query<Letter & { id: string }>(
      `select id, recipient, subject, body from pending_mail
        where sent_at is null order by created_at asc limit 20 for update skip locked`,
    );
    for (const letter of pending.rows) {
      try {
        await deliver(letter);
        await client.query('update pending_mail set sent_at = now(), attempts = attempts + 1 where id = $1', [
          letter.id,
        ]);
      } catch {
        await client.query('update pending_mail set attempts = attempts + 1 where id = $1', [
          letter.id,
        ]);
      }
    }
  });
}

export function startMailRetryLoop(): void {
  setInterval(() => {
    void retryPending().catch(() => undefined);
  }, config.mailRetrySeconds * 1000).unref();
}
