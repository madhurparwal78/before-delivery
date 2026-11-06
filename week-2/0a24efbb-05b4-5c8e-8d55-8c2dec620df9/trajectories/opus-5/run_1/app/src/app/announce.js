/**
 * The desk's one announcement store. It sits outside the component tree so that
 * announcing never re-renders the screens, and the live regions alone follow it.
 */
let state = { polite: '', assertive: '', toast: null };
const listeners = new Set();

function publish(next) {
  state = next;
  for (const listener of listeners) listener();
}

export const announce = {
  polite(message) {
    publish({ ...state, polite: message, toast: message === '' ? null : { message, tone: 'polite' } });
  },
  assertive(message) {
    publish({ ...state, assertive: message, toast: message === '' ? null : { message, tone: 'assertive' } });
  },
  dismissToast() {
    publish({ ...state, toast: null });
  },
};

export function announcementState() {
  return state;
}

export function subscribeToAnnouncements(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
