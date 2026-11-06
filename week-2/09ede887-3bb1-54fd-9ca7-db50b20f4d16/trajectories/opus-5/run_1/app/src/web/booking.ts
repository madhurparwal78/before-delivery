import { ApiFailure, api, newIdempotencyKey, type SessionView } from './api.js';
import { PENDING_COPY, SUCCESS_COPY, refusalCopy } from './copy.js';
import { say } from './dom.js';
import { navigate } from './router.js';
import { currentAccount } from './session.js';
import { signInHref } from './chrome.js';
import type { RowRefusal } from './components/sessionRow.js';

export type BookingAction = 'reserve' | 'cancel' | 'join' | 'leave' | 'claim' | 'release' | 'save' | 'unsave';

export type FocusWish =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'slot'; readonly list: string; readonly index: number };

export interface BookingHost {
  readonly messages: HTMLElement;
  /** Re-reads the page's data, redraws it, then applies the focus wish. */
  reload: (wish: FocusWish) => Promise<void>;
  /** Where a removal action leaves focus on a list page, if anywhere. */
  removalWish?: (action: BookingAction, sessionId: string) => FocusWish | null;
  setRowRefusal: (sessionId: string, refusal: RowRefusal | null) => void;
  titleOf: (sessionId: string) => string | null;
}

const PENDING: Readonly<Record<BookingAction, string>> = {
  reserve: PENDING_COPY.reserve,
  cancel: PENDING_COPY.cancel,
  join: PENDING_COPY.join,
  leave: PENDING_COPY.leave,
  claim: PENDING_COPY.claim,
  release: PENDING_COPY.release,
  save: PENDING_COPY.save,
  unsave: PENDING_COPY.save,
};

function needsAccount(): boolean {
  const account = currentAccount();
  if (account === null) {
    navigate(signInHref());
    return true;
  }
  return false;
}

async function perform(action: BookingAction, session: SessionView): Promise<string> {
  switch (action) {
    case 'reserve':
      await api.reserve(session.id, newIdempotencyKey());
      return SUCCESS_COPY.reserve;
    case 'cancel':
      await api.cancel(session.id);
      return SUCCESS_COPY.cancel;
    case 'join': {
      const joined = await api.joinWaitlist(session.id);
      return `You joined the waitlist. You are number ${joined.waitlist.position}.`;
    }
    case 'leave':
      await api.leaveWaitlist(session.id);
      return SUCCESS_COPY.leave;
    case 'claim':
      await api.claim(session.id);
      return SUCCESS_COPY.claim;
    case 'release':
      await api.release(session.id);
      return SUCCESS_COPY.release;
    case 'save':
      await api.save(session.id);
      return SUCCESS_COPY.saved;
    case 'unsave':
      await api.unsave(session.id);
      return SUCCESS_COPY.unsaved;
  }
}

function successWish(action: BookingAction, session: SessionView, host: BookingHost): FocusWish {
  const removal = host.removalWish?.(action, session.id) ?? null;
  if (removal !== null) return removal;
  if (action === 'save' || action === 'unsave') return { kind: 'key', key: `save:${session.id}` };
  return { kind: 'key', key: `seat:${session.id}` };
}

export function wireBookingControls(root: ParentNode, sessions: readonly SessionView[], host: BookingHost): void {
  const bySession = new Map(sessions.map((session) => [session.id, session]));
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-focus-key]')) {
    const key = button.dataset['focusKey'] ?? '';
    const [slot, sessionId] = key.split(':');
    if (sessionId === undefined) continue;
    const session = bySession.get(sessionId);
    if (session === undefined) continue;
    const action = actionFor(slot ?? '', session);
    if (action === null) continue;
    button.addEventListener('click', () => {
      void run(action, session, button, host);
    });
  }
}

function actionFor(slot: string, session: SessionView): BookingAction | null {
  if (slot === 'save') return session.saved_by_me ? 'unsave' : 'save';
  if (slot === 'claim') return 'claim';
  if (slot === 'release') return 'release';
  if (slot !== 'seat') return null;
  if (session.reserved_by_me) return 'cancel';
  if (session.waitlist_position !== null) return 'leave';
  if (session.seats !== null && session.seats.left <= 0) return 'join';
  return 'reserve';
}

async function run(
  action: BookingAction,
  session: SessionView,
  button: HTMLButtonElement,
  host: BookingHost,
): Promise<void> {
  if (button.getAttribute('aria-disabled') === 'true') return;
  if (needsAccount()) return;
  // Never the native disabled state: that would send focus to the page body.
  button.setAttribute('aria-disabled', 'true');
  button.classList.add('is-pending');
  say(host.messages, PENDING[action]);
  host.setRowRefusal(session.id, null);
  try {
    const message = await perform(action, session);
    say(host.messages, message);
    await host.reload(successWish(action, session, host));
  } catch (error) {
    const failure = error instanceof ApiFailure ? error : new ApiFailure('outage', 0);
    const conflictId = failure.conflictsWith;
    const conflictTitle = conflictId === null ? null : host.titleOf(conflictId) ?? (await titleFromServer(conflictId));
    say(host.messages, refusalCopy(failure.code, { title: conflictTitle ?? '', reserved: failure.reserved ?? 0 }));
    host.setRowRefusal(session.id, { code: failure.code, conflictId, conflictTitle });
    button.removeAttribute('aria-disabled');
    button.classList.remove('is-pending');
    await host.reload(refusalWish(failure.code, action, session, button));
  }
}

async function titleFromServer(sessionId: string): Promise<string | null> {
  try {
    return (await api.session(sessionId)).title;
  } catch {
    return null;
  }
}

function refusalWish(
  code: string,
  action: BookingAction,
  session: SessionView,
  button: HTMLButtonElement,
): FocusWish {
  if (code === 'session_full' || code === 'seats_available' || code === 'hold_expired' || code === 'no_hold') {
    return { kind: 'key', key: `seat:${session.id}` };
  }
  if (code === 'time_conflict') return { kind: 'key', key: `seat:${session.id}` };
  if (action === 'save' || action === 'unsave') return { kind: 'key', key: `save:${session.id}` };
  return { kind: 'key', key: button.dataset['focusKey'] ?? `seat:${session.id}` };
}

export function applyFocusWish(root: ParentNode, wish: FocusWish): void {
  if (wish.kind === 'key') {
    const target = root.querySelector<HTMLElement>(`[data-focus-key="${cssEscape(wish.key)}"]`);
    if (target !== null) {
      target.focus();
      return;
    }
    const seatKey = wish.key.replace(/^(claim|release|save):/, 'seat:');
    root.querySelector<HTMLElement>(`[data-focus-key="${cssEscape(seatKey)}"]`)?.focus();
    return;
  }
  const list = root.querySelector<HTMLElement>(`[data-list="${cssEscape(wish.list)}"]`);
  const rows = list === null ? [] : [...list.querySelectorAll<HTMLElement>(':scope > li')];
  const next = rows[wish.index] ?? rows[wish.index - 1] ?? null;
  const button = next?.querySelector<HTMLElement>('button') ?? next?.querySelector<HTMLElement>('a') ?? null;
  if (button !== null) {
    button.focus();
    return;
  }
  root.querySelector<HTMLElement>(`[data-empty="${cssEscape(wish.list)}"]`)?.focus();
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
