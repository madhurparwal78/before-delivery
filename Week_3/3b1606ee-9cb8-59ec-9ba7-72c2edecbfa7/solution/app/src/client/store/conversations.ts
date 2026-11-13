import type { Conversation } from '../../shared/types';
import { api, ApiFailure } from './api';
import { getState, setState } from './state';

type Listener = (conversations: Conversation[]) => void;
const listeners: Listener[] = [];

/** Modules that must react to fresh conversation records (peer profiles) register here. */
export function onConversations(listener: Listener): void {
  listeners.push(listener);
}

function adopt(records: Conversation[]): void {
  setState((current) => {
    const conversations = { ...current.conversations };
    for (const record of records) conversations[record.id] = record;
    return { conversations };
  });
  for (const listener of listeners) listener(records);
}

export function applyConversation(record: Conversation): void {
  adopt([record]);
}

export async function refreshConversations(): Promise<void> {
  const [accepted, requests] = await Promise.all([
    api<{ conversations: Conversation[] }>('GET', '/api/conversations?status=accepted'),
    api<{ conversations: Conversation[] }>('GET', '/api/conversations?status=request'),
  ]);
  const all = [...accepted.conversations, ...requests.conversations];
  setState({ conversations: Object.fromEntries(all.map((record) => [record.id, record])), conversationsLoaded: true });
  for (const listener of listeners) listener(all);
}

/** The conversation as the exchange has it now, or null when this person has no such conversation. */
export async function refreshConversation(id: string): Promise<Conversation | null> {
  try {
    const record = await api<Conversation>('GET', `/api/conversations/${id}`);
    adopt([record]);
    return record;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) {
      setState((current) => {
        const { [id]: _gone, ...rest } = current.conversations;
        return { conversations: rest };
      });
      return null;
    }
    throw error;
  }
}

export function displayName(accountId: string, username: string): string {
  return getState().profiles[accountId]?.displayName ?? username;
}

export const nameOf = (conversation: Conversation): string => displayName(conversation.peer.id, conversation.peer.username);

export function isMuted(conversation: Conversation): boolean {
  const until = conversation.muted_until;
  return until === 'always' || (until !== null && Date.parse(until) > Date.now());
}
