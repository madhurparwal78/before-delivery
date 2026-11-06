import { config } from './config';
import { q } from './db';
import { sendMail } from './smtp';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const wrap = (inner: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cairn</title><style>body{font-family:system-ui,sans-serif;line-height:1.5;max-width:640px;margin:2rem auto;padding:0 1rem;color:#222}a{color:#a3600c}p{margin:0.75rem 0}</style></head><body>${inner}</body></html>`;

const enqueue = async (e: OutgoingEmail): Promise<void> => {
  await q(
    'insert into emails(id, to_addr, subject, text, html) values (gen_random_uuid(), $1, $2, $3, $4)',
    [e.to, e.subject, e.text, e.html],
  );
};

export const mail = {
  queue: enqueue,

  /** Try to send every unsent email; returns how many were sent. */
  flush: async (): Promise<number> => {
    const rows = await q<{ id: string; to_addr: string; subject: string; text: string; html: string }>(
      'select id, to_addr, subject, text, html from emails where sent = false order by created_at limit 50',
    );
    if (rows.rows.length === 0) return 0;
    let sent = 0;
    for (const row of rows.rows) {
      let ok = false;
      try {
        await sendMail({
          from: config.smtp.from,
          to: row.to_addr,
          subject: row.subject,
          text: row.text,
          html: row.html,
        });
        ok = true;
      } catch {
        ok = false;
      }
      await q('update emails set sent = $2, tries = tries + 1 where id = $1', [row.id, ok]);
      if (ok) sent++;
    }
    return sent;
  },
};

export const deviceApprovalEmail = async (
  to: string,
  deviceName: string,
  link: string,
  expiresAt: Date,
  whenText: string,
): Promise<void> => {
  const text = `A new device signed in to your Cairn account.

Device: ${deviceName}
Signed in: ${whenText}

Approve it here (valid until ${expiresAt.toISOString()}):
${link}

If you did not sign in, ignore this email.`;
  await mail.queue({
    to,
    subject: 'Approve a new Cairn device',
    text,
    html: wrap(
      `<p>A new device signed in to your Cairn account.</p><p>Device: <strong>${deviceName}</strong></p><p>Signed in: ${whenText}</p><p><a href="${link}">Approve this device</a> (valid until ${expiresAt.toISOString()})</p><p>If you did not sign in, ignore this email.</p>`,
    ),
  });
};

export const inviteEmail = async (
  to: string,
  inviter: string,
  link: string,
  expiresAt: Date,
): Promise<void> => {
  const text = `${inviter} invited you to a shared Cairn vault.

Accept here (valid until ${expiresAt.toISOString()}):
${link}

${inviter} will share the vault passphrase with you separately.`;
  await mail.queue({
    to,
    subject: `${inviter} invited you to a shared Cairn vault`,
    text,
    html: wrap(
      `<p>${inviter} invited you to a shared Cairn vault.</p><p><a href="${link}">Accept the invite</a> (valid until ${expiresAt.toISOString()})</p><p>${inviter} will share the vault passphrase with you separately.</p>`,
    ),
  });
};

export const publishWarningEmail = async (
  to: string,
  whenText: string,
  urls: string[],
): Promise<void> => {
  const list = urls.map((u) => `- ${u}`).join('\n');
  const text = `Your Cairn Publish add-on has lapsed. Your published dossiers go offline on ${whenText}.

Published dossiers:
${list}

Renew Publish before then to keep them online.`;
  await mail.queue({
    to,
    subject: `Cairn Publish: your dossiers go offline on ${whenText}`,
    text,
    html: wrap(
      `<p>Your Cairn Publish add-on has lapsed. Your published dossiers go offline on <strong>${whenText}</strong>.</p><p>Published dossiers:</p><ul>${urls
        .map((u) => `<li><a href="${u}">${u}</a></li>`)
        .join('')}</ul><p>Renew Publish before then to keep them online.</p>`,
    ),
  });
};
