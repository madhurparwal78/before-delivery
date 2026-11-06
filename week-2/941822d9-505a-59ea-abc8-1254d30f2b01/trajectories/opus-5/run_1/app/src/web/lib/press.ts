const PRESS_KEY = 'credwell:press:';

/** The Seal press plays once, the first time this browser sees the completion screen. */
export function markPressPending(enrolmentId: string): void {
  window.sessionStorage.setItem(`${PRESS_KEY}${enrolmentId}`, 'pending');
}

export function takePressPending(enrolmentId: string): boolean {
  const key = `${PRESS_KEY}${enrolmentId}`;
  const found = window.sessionStorage.getItem(key) !== null;
  if (found) window.sessionStorage.removeItem(key);
  return found;
}
