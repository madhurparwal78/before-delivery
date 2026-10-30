import type { Role } from '../../shared/types';
import { monthLabel } from '../../shared/format';
import { newId, type Queryable } from '../db';
import { env } from '../env';

/**
 * Close-the-loop content carries only published fields: feature name, public
 * description, release name and target month, plus the recipient's own name and
 * the workspace name.
 */
export interface ShippedFeatureLine {
  name: string;
  publicDescription: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  head_of_product: 'Head of product',
  product_manager: 'Product manager',
  customer_success: 'Customer success',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

export interface ShipEmailInput {
  contactName: string;
  workspaceName: string;
  releaseName: string;
  targetMonth: string;
  features: readonly ShippedFeatureLine[];
}

export function renderShipEmail(input: ShipEmailInput): {
  subject: string;
  textBody: string;
  htmlBody: string;
} {
  const label = monthLabel(input.targetMonth);
  const greeting = `Hi ${input.contactName},`;
  const lead = `You asked for these, and they are now live in ${input.releaseName} (${label}):`;
  const lines = input.features.map((feature) => `${feature.name} \u2014 ${feature.publicDescription}`);
  const signature = `\u2014 The ${input.workspaceName} product team`;
  return {
    subject: `You asked, we shipped: ${input.releaseName}`,
    textBody: [greeting, '', lead, '', ...lines, '', signature].join('\n'),
    htmlBody: [
      '<!doctype html><html><body>',
      `<p>${escapeHtml(greeting)}</p>`,
      `<p>${escapeHtml(lead)}</p>`,
      '<ul>',
      ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
      '</ul>',
      `<p>${escapeHtml(signature)}</p>`,
      '</body></html>',
    ].join(''),
  };
}

export function renderInvitationEmail(input: {
  workspaceName: string;
  role: Role;
  token: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const link = `${env.baseUrl}/invite/${input.token}`;
  const roleLabel = ROLE_LABELS[input.role];
  const lines = [
    `You have been invited to join ${input.workspaceName} on Evidence Desk as ${roleLabel}.`,
    '',
    'Open this link to set your name and password:',
    link,
  ];
  return {
    subject: `You're invited to ${input.workspaceName} on Evidence Desk`,
    textBody: lines.join('\n'),
    htmlBody:
      '<!doctype html><html><body>' +
      `<p>${escapeHtml(lines[0])}</p>` +
      `<p>${escapeHtml(lines[2])}</p>` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
      '</body></html>',
  };
}

/** Every email is written to the outbox in the same transaction as its cause. */
export async function enqueueEmail(
  db: Queryable,
  workspaceId: string,
  releaseId: string | null,
  recipient: { name: string; email: string },
  content: { subject: string; textBody: string; htmlBody: string },
): Promise<void> {
  await db.query(
    `INSERT INTO outbox (id, workspace_id, release_id, recipient_name, recipient_email,
                         subject, text_body, html_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newId(),
      workspaceId,
      releaseId,
      recipient.name,
      recipient.email,
      content.subject,
      content.textBody,
      content.htmlBody,
    ],
  );
}
