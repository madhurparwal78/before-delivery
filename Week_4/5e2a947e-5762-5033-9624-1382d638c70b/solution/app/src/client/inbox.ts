import type { MentionInfo } from '../shared/model.ts';
import { api } from './api.ts';
import { signal } from './signal.ts';

/** Unread mentions for the signed-in person. Every `InboxButton` reads this, so the editor can update the count live. */
export const inboxUnread$ = signal(0);

export const setInboxUnread = (n: number): void => inboxUnread$.set(Math.max(0, Math.trunc(n)));

interface InboxResponse {
  mentions: MentionInfo[];
  unread: number;
}

/** Fetch the inbox, update the shared count and return the unread mentions. A failed fetch leaves the count alone. */
export async function loadInbox(): Promise<MentionInfo[]> {
  try {
    const body = await api<InboxResponse>('GET', '/api/inbox');
    setInboxUnread(body.unread);
    return body.mentions.filter((m) => !m.read);
  } catch {
    return [];
  }
}


/** Mark one mention read; the server answers with the new unread count. */
export async function markMentionRead(id: string): Promise<void> {
  try {
    const body = await api<{ unread: number }>('POST', `/api/inbox/${encodeURIComponent(id)}/read`);
    setInboxUnread(body.unread);
  } catch {
    /* the count catches up on the next refresh */
  }
}

export const mentionHref = (m: MentionInfo): string =>
  `/m/${encodeURIComponent(m.map_id)}?topic=${encodeURIComponent(m.topic_id)}&comment=${encodeURIComponent(m.comment_id)}`;
