import { useCallback, useRef, useState } from 'react';
import type { Session, WaitlistJoined } from '../../shared/api';
import { request, sessionPath } from '../api';
import { conflictCopy, OUTAGE_COPY, refusalCopy } from '../copy';
import { useFocusAfterRender, type FocusFinder } from '../hooks';
import { signInPath, useRouter } from '../router';
import { useApp } from '../state';

// One booking press, from pending to answer to focus, shared by the board, the session page
// and My Agenda.

export type BookingAction = 'reserve' | 'cancel' | 'join' | 'leave' | 'claim' | 'release' | 'save' | 'unsave';

interface ActionSpec {
  method: 'POST' | 'DELETE' | 'PUT';
  path: string;
  pending: string;
  success: string;
}

const ACTIONS: Record<BookingAction, ActionSpec> = {
  reserve: { method: 'POST', path: 'reservation', pending: 'Reserving seat…', success: 'Seat reserved.' },
  cancel: { method: 'DELETE', path: 'reservation', pending: 'Cancelling…', success: 'Reservation cancelled. Your seat has been released.' },
  join: { method: 'POST', path: 'waitlist', pending: 'Joining waitlist…', success: 'You joined the waitlist.' },
  leave: { method: 'DELETE', path: 'waitlist', pending: 'Leaving waitlist…', success: 'You left the waitlist.' },
  claim: { method: 'POST', path: 'claim', pending: 'Claiming seat…', success: 'Seat claimed. It is yours.' },
  release: { method: 'DELETE', path: 'hold', pending: 'Releasing hold…', success: 'Hold released.' },
  save: { method: 'PUT', path: 'save', pending: 'Saving…', success: 'Saved to My Agenda.' },
  unsave: { method: 'DELETE', path: 'save', pending: 'Saving…', success: 'Removed from My Agenda.' },
};

// Refusals after which the row re-reads the session and focus goes to its new seat action.
const REREAD = new Set(['session_full', 'seats_available', 'hold_expired', 'no_hold']);

export interface Refusal {
  code: string;
  conflict: { id: string; title: string } | null;
}

export interface Booking {
  pending: ReadonlyMap<string, BookingAction>;
  refusals: ReadonlyMap<string, Refusal>;
  message: string;
  busy: boolean;
  run: (action: BookingAction, session: Session, context: string) => void;
}

export function rowKey(context: string, sessionId: string): string {
  return `${context}:${sessionId}`;
}

function find(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

function rowSelector(key: string): string {
  return `[data-row="${CSS.escape(key)}"]`;
}

function listOrder(context: string): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-list="${CSS.escape(context)}"] > [data-row]`)).map(
    (row) => row.dataset.row ?? '',
  );
}

// Where focus goes after an answer: the row's control in `slot`; when the row has left its
// list, the next row's first button, else the previous row's, else the list's empty line.
function focusFinder(key: string, slot: 'seat' | 'save', context: string, order: string[], claimedTitle: string | null): FocusFinder {
  return () => {
    const row = find(rowSelector(key));
    if (row) return row.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    if (claimedTitle) return find(`button[aria-label="${CSS.escape(`Cancel reservation for ${claimedTitle}`)}"]`);
    const index = order.indexOf(key);
    const neighbours = [...order.slice(index + 1), ...order.slice(0, Math.max(index, 0)).reverse()];
    for (const neighbour of neighbours) {
      const button = find(rowSelector(neighbour))?.querySelector<HTMLElement>('button');
      if (button) return button;
    }
    return find(`[data-empty="${CSS.escape(context)}"]`);
  };
}

export function useBooking(refresh: () => Promise<void>): Booking {
  const { auth, viewer, dropAuth } = useApp();
  const { place, navigate } = useRouter();
  const focusLater = useFocusAfterRender();
  const [pending, setPending] = useState<ReadonlyMap<string, BookingAction>>(new Map());
  const [refusals, setRefusals] = useState<ReadonlyMap<string, Refusal>>(new Map());
  const [message, setMessage] = useState('');
  const pendingRef = useRef(pending);

  const run = useCallback(
    (action: BookingAction, session: Session, context: string) => {
      if (pendingRef.current.has(session.id)) return;
      if (!auth || viewer !== 'attendee') {
        if (!auth) navigate(signInPath(place));
        return;
      }
      const spec = ACTIONS[action];
      const key = rowKey(context, session.id);
      const order = listOrder(context);
      const mark = (next: Map<string, BookingAction>) => {
        pendingRef.current = next;
        setPending(next);
      };
      mark(new Map(pendingRef.current).set(session.id, action));
      setMessage(spec.pending);
      setRefusals((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });

      void (async () => {
        const result = await request<WaitlistJoined>(sessionPath(session.id, spec.path), {
          method: spec.method,
          token: auth.token,
          headers: action === 'reserve' ? { 'Idempotency-Key': crypto.randomUUID() } : undefined,
          retryOnce: action === 'reserve',
        });
        let text: string;
        let refusal: Refusal | null = null;
        let moveFocus = true;
        const outage = !result.ok && result.error.code === 'unavailable';
        if (result.ok) {
          text = action === 'join' ? `You joined the waitlist. You are number ${result.data.waitlist.position}.` : spec.success;
        } else if (outage) {
          text = OUTAGE_COPY;
          moveFocus = false;
        } else {
          const code = result.error.code;
          if (code === 'unauthenticated') dropAuth();
          let conflict: Refusal['conflict'] = null;
          if (code === 'time_conflict' && result.error.conflicts_with) {
            const id = result.error.conflicts_with;
            const other = await request<Session>(sessionPath(id), { token: auth.token });
            conflict = { id, title: other.ok ? other.data.title : id };
          }
          text = conflict ? conflictCopy(conflict.title) : refusalCopy(code);
          refusal = { code, conflict };
          moveFocus = REREAD.has(code);
        }
        if (!outage) await refresh();
        const next = new Map(pendingRef.current);
        next.delete(session.id);
        mark(next);
        setMessage(text);
        if (refusal) {
          const shown = refusal;
          setRefusals((current) => new Map(current).set(key, shown));
        }
        if (moveFocus) {
          const slot = action === 'save' || action === 'unsave' ? 'save' : 'seat';
          focusLater(focusFinder(key, slot, context, order, action === 'claim' && result.ok ? session.title : null));
        }
      })();
    },
    [auth, viewer, navigate, place, dropAuth, refresh, focusLater],
  );

  return { pending, refusals, message, busy: pending.size > 0, run };
}
