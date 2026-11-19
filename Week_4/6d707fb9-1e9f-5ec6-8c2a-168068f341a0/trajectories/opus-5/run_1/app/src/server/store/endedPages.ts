import { one, query } from '../db/pool';
import type { Language } from '../domain/numbers';

/** A private address a new one replaced, kept so it answers 410 rather than 404. */
export async function endPage(
  token: string,
  kind: 'answer' | 'signOff',
  language: Language,
  now: number,
): Promise<void> {
  await query(
    `insert into ended_pages (token, kind, language, ended_at) values ($1,$2,$3,$4)
     on conflict (token) do nothing`,
    [token, kind, language, now],
  );
}

export async function readEndedPage(
  token: string,
): Promise<{ kind: 'answer' | 'signOff'; language: Language } | null> {
  return one<{ kind: 'answer' | 'signOff'; language: Language }>(
    'select kind, language from ended_pages where token = $1',
    [token],
  );
}
