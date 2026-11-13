import { config } from '../config.js';
import { t, type Locale } from '../../shared/i18n/index.js';
import type { OutgoingMail } from './smtp.js';

type MailKind = 'verification' | 'reset';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Each email is written entirely in the account's locale and holds exactly one link. */
export function buildMail(
  kind: MailKind,
  locale: Locale,
  to: string,
  token: string,
): OutgoingMail {
  const path = kind === 'verification' ? '/verify' : '/reset-password';
  const link = `${config.publicUrl}${path}?token=${encodeURIComponent(token)}`;
  const heading = t(locale, kind === 'verification' ? 'mail.verifyHeading' : 'mail.resetHeading');
  const intro = t(locale, kind === 'verification' ? 'mail.verifyBody' : 'mail.resetBody');
  const action = t(locale, kind === 'verification' ? 'mail.verifyLink' : 'mail.resetLink');
  const ignore = t(locale, 'mail.ignore');
  const subject = t(locale, kind === 'verification' ? 'mail.verifySubject' : 'mail.resetSubject');

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><title>${escapeHtml(heading)}</title></head>
<body style="background:#faf6ee;color:#1d1d1f;font-family:sans-serif">
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p>
<p>${escapeHtml(ignore)}</p>
</body>
</html>`;

  const text = `${heading}\n\n${intro}\n\n${action}: ${link}\n\n${ignore}\n`;

  return { to, subject, html, text, lang: locale };
}
