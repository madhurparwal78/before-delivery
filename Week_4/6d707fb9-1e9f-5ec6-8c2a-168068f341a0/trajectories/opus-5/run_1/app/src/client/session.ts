import { announce, api, errorOf, type ApiAnswer } from './dom';
import { saveDraft } from './drafts';
import { copy } from '../server/domain/copy';

let ended = false;

/** A session the server has ended keeps the open dialog as typed. */
function showSessionBand(): void {
  if (ended) return;
  ended = true;
  saveDraft();
  const band = document.createElement('div');
  band.className = 'session-band';
  band.setAttribute('data-part', 'session-band');
  const text = document.createElement('p');
  text.textContent = copy.sessionEnded;
  const link = document.createElement('a');
  link.href = `/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`;
  link.textContent = 'Sign in again';
  band.append(text, link);
  document.body.append(band);
  link.focus();
  announce(copy.sessionEnded);
}

export async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiAnswer> {
  const answer = await api(method, path, body, headers);
  const failure = errorOf(answer);
  const codes = ['session_ended', 'not_signed_in'];
  if (answer.status === 401 && failure && codes.includes(failure.code)) showSessionBand();
  return answer;
}

export function sessionEnded(): boolean {
  return ended;
}
