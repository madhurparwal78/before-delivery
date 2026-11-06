import type { SessionView } from './api.js';

const titles = new Map<string, string>();

export function rememberTitles(sessions: readonly SessionView[]): void {
  for (const session of sessions) titles.set(session.id, session.title);
}

export function titleOf(sessionId: string): string | null {
  return titles.get(sessionId) ?? null;
}
