import { escapeAttribute, escapeHtml } from '../shared/markdown';
import { newId } from './auth';
import type { Config } from './config';
import type { Database } from './db';
import { sendEmail, type OutgoingEmail } from './smtp';

export interface MailRequest extends OutgoingEmail {
  dedupeKey?: string;
}

interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  text_body: string;
  html_body: string;
}

export class Mailer {
  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {}

  /** Queues a message and tries to deliver it at once; the sweep retries whatever is left. */
  async send(request: MailRequest): Promise<void> {
    const id = newId();
    const inserted = await this.db.one<{ id: string }>(
      `insert into email_outbox (id, to_email, subject, text_body, html_body, dedupe_key)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (dedupe_key) do nothing
         returning id`,
      [id, request.to, request.subject, request.textBody, request.htmlBody, request.dedupeKey ?? null],
    );
    if (!inserted) return;
    await this.deliver({
      id,
      to_email: request.to,
      subject: request.subject,
      text_body: request.textBody,
      html_body: request.htmlBody,
    });
  }

  private async deliver(row: OutboxRow): Promise<boolean> {
    try {
      await sendEmail(this.config.mail.host, this.config.mail.port, this.config.mail.from, {
        to: row.to_email,
        subject: row.subject,
        textBody: row.text_body,
        htmlBody: row.html_body,
      });
      await this.db.query('update email_outbox set sent_at = now(), attempts = attempts + 1 where id = $1', [row.id]);
      return true;
    } catch (error) {
      await this.db.query('update email_outbox set attempts = attempts + 1, last_error = $2 where id = $1', [
        row.id,
        error instanceof Error ? error.message.slice(0, 500) : 'send failed',
      ]);
      return false;
    }
  }

  async retryUnsent(): Promise<number> {
    const rows = await this.db.query<OutboxRow>(
      'select id, to_email, subject, text_body, html_body from email_outbox where sent_at is null order by created_at limit 50',
    );
    let sent = 0;
    for (const row of rows) {
      if (await this.deliver(row)) sent += 1;
    }
    return sent;
  }
}

function htmlDocument(heading: string, paragraphs: readonly string[], link: { href: string; label: string } | null): string {
  const body = paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('\n');
  const action = link ? `\n<p><a href="${escapeAttribute(link.href)}">${escapeHtml(link.label)}</a></p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<body>
<h1>${escapeHtml(heading)}</h1>
${body}${action}
</body>
</html>
`;
}

export function deviceApprovalEmail(
  to: string,
  deviceName: string,
  signInTime: string,
  link: string,
  expiresAt: string,
): MailRequest {
  const lines = [
    `A new device asked to join your Cairn account: ${deviceName}.`,
    `Sign-in time: ${signInTime}.`,
    `Approve it here: ${link}`,
    `This link expires at ${expiresAt}.`,
  ];
  return {
    to,
    subject: 'Approve a new Cairn device',
    textBody: `${lines.join('\n\n')}\n`,
    htmlBody: htmlDocument('Approve a new Cairn device', lines.slice(0, 2).concat(lines[3] ?? ''), {
      href: link,
      label: 'Approve this device',
    }),
  };
}

export function inviteEmail(to: string, inviter: string, link: string, expiresAt: string): MailRequest {
  const lines = [
    `${inviter} invited you to co-edit a shared Cairn vault.`,
    `Accept the invite here: ${link}`,
    `This link expires at ${expiresAt}.`,
    `${inviter} will share the vault passphrase with you separately. Cairn never sends it.`,
  ];
  return {
    to,
    subject: `${inviter} invited you to a shared Cairn vault`,
    textBody: `${lines.join('\n\n')}\n`,
    htmlBody: htmlDocument(
      'You have been invited to a shared Cairn vault',
      [lines[0] ?? '', lines[2] ?? '', lines[3] ?? ''],
      { href: link, label: 'Accept invite' },
    ),
  };
}

export function publishWarningEmail(
  to: string,
  takedownDisplay: string,
  dossierUrls: readonly string[],
): MailRequest {
  const lines = [
    `Your Cairn Publish add-on has ended, so your published dossiers go offline on ${takedownDisplay}.`,
    `Addresses that go offline: ${dossierUrls.join(', ')}`,
    'Add Publish again before then to keep them online.',
  ];
  return {
    to,
    subject: `Cairn Publish: your dossiers go offline on ${takedownDisplay}`,
    textBody: `${lines.join('\n\n')}\n`,
    htmlBody: htmlDocument('Your dossiers go offline soon', lines, null),
  };
}
