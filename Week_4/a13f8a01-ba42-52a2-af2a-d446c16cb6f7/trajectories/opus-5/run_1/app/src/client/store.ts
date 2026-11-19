import type { ClientConfig, User } from '../shared/api';
import { api, ApiFailure } from './api';

interface Session {
  config: ClientConfig;
  user: User | null;
}

let session: Session | null = null;

export const loadSession = async (): Promise<Session> => {
  const config = await api.get<ClientConfig>('/api/config');
  let user: User | null = null;
  try {
    user = (await api.get<{ user: User }>('/api/me')).user;
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
  }
  session = { config, user };
  return session;
};

export const current = (): Session => {
  if (!session) throw new Error('The session is not loaded yet');
  return session;
};

export const config = (): ClientConfig => current().config;
export const me = (): User | null => current().user;

export const setVerified = (): void => {
  const loaded = current();
  if (loaded.user) loaded.user = { ...loaded.user, verified: true };
};

export interface CountsEvent {
  pen_id: string;
  likes: number;
  forks: number;
}

export interface HeadEvent {
  pen_id: string;
  head: number;
}

export interface LiveHandlers {
  counts?: (event: CountsEvent) => void;
  head?: (event: HeadEvent) => void;
  account?: () => void;
}

/** One stream per page carries like counts, fork counts and verification state. */
export const live = (penIds: readonly string[], handlers: LiveHandlers): EventSource => {
  const source = new EventSource(`/api/events?pens=${penIds.join(',')}`);
  if (handlers.counts) {
    source.addEventListener('counts', (event) =>
      handlers.counts!(JSON.parse((event as MessageEvent<string>).data) as CountsEvent),
    );
  }
  if (handlers.head) {
    source.addEventListener('head', (event) =>
      handlers.head!(JSON.parse((event as MessageEvent<string>).data) as HeadEvent),
    );
  }
  source.addEventListener('account', () => {
    setVerified();
    handlers.account?.();
  });
  window.addEventListener('pagehide', () => source.close());
  return source;
};
