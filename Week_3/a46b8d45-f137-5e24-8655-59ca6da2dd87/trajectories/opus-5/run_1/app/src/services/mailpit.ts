/**
 * Erasure deletes each message whose recipient address equals the owner's email, compared
 * in any letter case, and no other message. An address that merely contains the owner's
 * email is a different address and is kept.
 */

import { config } from '../config';
import { normaliseEmail } from '../domain/references';
import { MailUnavailable } from './outages';

const REQUEST_TIMEOUT_MS = 8000;

interface MailpitRecipient {
  Address?: unknown;
}

interface MailpitMessage {
  ID?: unknown;
  To?: unknown;
  Cc?: unknown;
  Bcc?: unknown;
}

async function call(method: 'GET' | 'DELETE', path: string, body?: unknown): Promise<Response> {
  try {
    const response = await fetch(`${config.mail.mailpitUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 500) throw new MailUnavailable(new Error(`mail answered ${response.status}`));
    return response;
  } catch (error) {
    if (error instanceof MailUnavailable) throw error;
    throw new MailUnavailable(error);
  }
}

function addressesOf(message: MailpitMessage): string[] {
  const groups = [message.To, message.Cc, message.Bcc];
  const addresses: string[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const entry of group as MailpitRecipient[]) {
      if (typeof entry.Address === 'string') addresses.push(entry.Address);
    }
  }
  return addresses;
}

/** Checks that Mailpit is answering, so an erasure can refuse before it changes anything. */
export async function requireMail(): Promise<void> {
  const response = await call('GET', '/api/v1/messages?limit=1');
  if (!response.ok) throw new MailUnavailable(new Error(`mail refused listing: ${response.status}`));
}

export async function deleteMessagesTo(email: string): Promise<void> {
  const wanted = normaliseEmail(email);
  const response = await call('GET', '/api/v1/messages?limit=1000');
  if (!response.ok) throw new MailUnavailable(new Error(`mail refused listing: ${response.status}`));

  let listing: { messages?: unknown };
  try {
    listing = (await response.json()) as { messages?: unknown };
  } catch (error) {
    throw new MailUnavailable(error);
  }

  const messages = Array.isArray(listing.messages) ? (listing.messages as MailpitMessage[]) : [];
  const doomed = messages
    .filter((message) => addressesOf(message).some((address) => normaliseEmail(address) === wanted))
    .map((message) => message.ID)
    .filter((id): id is string => typeof id === 'string');

  if (doomed.length === 0) return;
  const deleted = await call('DELETE', '/api/v1/messages', { IDs: doomed });
  if (!deleted.ok) throw new MailUnavailable(new Error(`mail refused delete: ${deleted.status}`));
}
