// Invitation and mention mail, sent through the SMTP client.
import { sendMail } from './smtp.js';
import { config } from './config.js';

export interface InviteMail { to: string; inviterName: string; workspaceName: string; role: 'editor' | 'viewer'; token: string }

export async function sendInviteMail(m: InviteMail): Promise<void> {
  const link = `${config.publicUrl}/invites/${m.token}`;
  await sendMail({
    to: m.to,
    subject: `${m.inviterName} invited you to ${m.workspaceName} as ${m.role}`,
    text: `You have been invited to the workspace ${m.workspaceName} as a ${m.role}.\n\nUse this link to accept:\n\n${link}\n`,
  });
}

export interface MentionMail { to: string; byName: string; pageName: string; nodeName: string; body: string; pageId: string }

export async function sendMentionMail(m: MentionMail): Promise<void> {
  const link = `${config.publicUrl}/w/${workspaceOfPage(m.pageId)}/edit?page=${m.pageId}`;
  await sendMail({
    to: m.to,
    subject: `${m.byName} mentioned you on ${m.pageName}`,
    text: `${m.byName} mentioned you on the node ${m.nodeName}:\n\n"${m.body}"\n\n${link}\n`,
  });
}

function workspaceOfPage(pageId: string): string {
  return pageId.split('_')[0];
}
