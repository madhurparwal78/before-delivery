import { config } from '../config.js';
import { Mail } from '../infra/mail.js';

/** Each run of line breaks, tabs or other control characters becomes one space. */
export function headerSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ');
}

function bodyText(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function inviteEmail(input: {
  to: string;
  inviterName: string;
  projectTitle: string;
  role: string;
  token: string;
  expiresAt: string;
}): Mail {
  const inviter = headerSafe(input.inviterName);
  const title = headerSafe(input.projectTitle);
  const role = headerSafe(input.role);
  return {
    to: input.to,
    subject: `${inviter} invited you to ${title} on Marginalia`,
    body:
      `${inviter} invited you to ${title} on Marginalia as ${role}.\n` +
      '\n' +
      `Accept the invitation: ${config.appBaseUrl}/invite/${input.token}\n` +
      `This link expires on ${input.expiresAt}.\n`,
  };
}

export function mentionEmail(input: {
  to: string;
  authorName: string;
  projectTitle: string;
  commentBody: string;
  quote: string;
  projectId: string;
  threadId: string;
}): Mail {
  const author = headerSafe(input.authorName);
  const title = headerSafe(input.projectTitle);
  return {
    to: input.to,
    subject: `${author} mentioned you on ${title}`,
    body:
      `${author} mentioned you on ${title}:\n` +
      '\n' +
      `${bodyText(input.commentBody)}\n` +
      '\n' +
      `On the passage: "${bodyText(input.quote)}"\n` +
      `Open the thread: ${config.appBaseUrl}/p/${input.projectId}?thread=${input.threadId}\n`,
  };
}
