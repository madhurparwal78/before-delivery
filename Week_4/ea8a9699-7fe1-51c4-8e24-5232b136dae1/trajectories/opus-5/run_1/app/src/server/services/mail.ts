import { deliver, type Message } from './smtp.js';

export type { Message };

export async function sendMail(message: Message): Promise<void> {
  await deliver(message);
}

export function inviteMessage(params: {
  to: string;
  workspaceName: string;
  leadName: string;
  url: string;
}): Message {
  return {
    to: params.to,
    subject: `You're invited to ${params.workspaceName} on Rushes`,
    text:
      `${params.leadName} invited you to the ${params.workspaceName} workspace on Rushes.\r\n` +
      `Accept the invite: ${params.url}\r\n`,
  };
}

export function reviewLinkMessage(params: {
  to: string;
  clusterTitle: string;
  workspaceName: string;
  url: string;
  expiresAt: Date;
}): Message {
  const expiry = `${params.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return {
    to: params.to,
    subject: `Review ${params.clusterTitle} for ${params.workspaceName}`,
    text: `Review link: ${params.url}\r\nThis link expires ${expiry}.\r\n`,
  };
}

export function receiptMessage(params: {
  to: string;
  workspaceName: string;
  planName: string;
  seatCap: number;
  monthlyPrice: string;
}): Message {
  return {
    to: params.to,
    subject: `Rushes receipt: ${params.workspaceName} is now on ${params.planName}`,
    text:
      `${params.workspaceName} is now on ${params.planName}.\r\n` +
      `Seats: ${params.seatCap}\r\n` +
      `Monthly price: $${params.monthlyPrice}\r\n`,
  };
}

export function digestMessage(params: {
  to: string;
  ownerDisplayName: string;
  clusterTitle: string;
  body: string;
}): Message {
  return {
    to: params.to,
    subject: `New from ${params.ownerDisplayName}: ${params.clusterTitle}`,
    text: params.body,
  };
}
