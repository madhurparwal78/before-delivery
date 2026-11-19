import { formatAmountForDisplay } from '../domain/money.js';
import type { OutgoingMail } from './smtp.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface InviteMailInput {
  readonly to: string;
  readonly title: string;
  readonly joinUrl: string;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly timeZone: string;
}

/** One message per distinct invited address, carrying the link active when it leaves. */
export function inviteMail(input: InviteMailInput): OutgoingMail {
  const when = `${input.scheduledStart} to ${input.scheduledEnd} (${input.timeZone})`;
  const text = [
    `You're invited to the workshop "${input.title}".`,
    '',
    `When: ${when}`,
    `Join here: ${input.joinUrl}`,
    '',
    'No account is needed — open the link and type your name.',
  ].join('\n');
  const html = [
    '<!doctype html><html><body>',
    `<p>You're invited to the workshop &ldquo;${escapeHtml(input.title)}&rdquo;.</p>`,
    `<p>When: ${escapeHtml(when)}</p>`,
    `<p><a href="${escapeHtml(input.joinUrl)}">${escapeHtml(input.joinUrl)}</a></p>`,
    '<p>No account is needed — open the link and type your name.</p>',
    '</body></html>',
  ].join('');
  return { to: input.to, subject: `You're invited: ${input.title}`, text, html };
}

export interface RecapClusterLine {
  readonly frameTitle: string;
  readonly title: string;
  readonly dotTotal: number;
  readonly noteTexts: readonly string[];
}

export interface RecapMailInput {
  readonly to: string;
  readonly title: string;
  readonly recapUrl: string;
  readonly clusters: readonly RecapClusterLine[];
  readonly invoice: { readonly number: string; readonly amount: string } | null;
}

/**
 * One message per recipient. The bodies carry the recap link, the cluster ranking with each
 * cluster's dot total and note texts, and the invoice line when there is an invoice.
 * No participant name and no facilitator-only note ever appears here.
 */
export function recapMail(input: RecapMailInput): OutgoingMail {
  const invoiceLine =
    input.invoice === null
      ? null
      : `Invoice ${input.invoice.number} — €${formatAmountForDisplay(input.invoice.amount)}`;

  const textLines = [`Recap of "${input.title}"`, '', `Open the recap: ${input.recapUrl}`, ''];
  if (invoiceLine !== null) textLines.push(invoiceLine, '');
  textLines.push('Cluster ranking:');
  for (const cluster of input.clusters) {
    textLines.push(`- ${cluster.title} (${cluster.frameTitle}) — ${cluster.dotTotal} dots`);
    for (const note of cluster.noteTexts) textLines.push(`    • ${note}`);
  }

  const htmlParts = [
    '<!doctype html><html><body>',
    `<h1>Recap of &ldquo;${escapeHtml(input.title)}&rdquo;</h1>`,
    `<p><a href="${escapeHtml(input.recapUrl)}">${escapeHtml(input.recapUrl)}</a></p>`,
  ];
  if (invoiceLine !== null) htmlParts.push(`<p>${escapeHtml(invoiceLine)}</p>`);
  htmlParts.push('<h2>Cluster ranking</h2><ol>');
  for (const cluster of input.clusters) {
    htmlParts.push(
      `<li>${escapeHtml(cluster.title)} (${escapeHtml(cluster.frameTitle)}) — ${cluster.dotTotal} dots<ul>`,
      ...cluster.noteTexts.map((note) => `<li>${escapeHtml(note)}</li>`),
      '</ul></li>',
    );
  }
  htmlParts.push('</ol></body></html>');

  return {
    to: input.to,
    subject: `Recap: ${input.title}`,
    text: textLines.join('\n'),
    html: htmlParts.join(''),
  };
}
