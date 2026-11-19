import { ERRORS, PENDING, SIGN_IN_AGAIN_LINE } from '../../shared/copy';
import { ApiRefusal, request } from '../shared/api';
import { el, focusTarget, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { focusFirstControl, openOverlay } from '../shared/overlay';

export const sessionEnded = (error: unknown): boolean =>
  error instanceof ApiRefusal && error.code === 'not_signed_in';

let open: Promise<void> | null = null;

/**
 * Opens `dialog "Sign in again"` over the page. The page, typed values, the chosen
 * file and any notices stay as they were, and the dialog closes only on a successful
 * sign-in.
 */
export const signInAgain = (): Promise<void> => {
  if (open !== null) return open;
  open = new Promise<void>((resolve) => {
    const overlay = openOverlay({
      name: 'Sign in again',
      variant: 'signin',
      opener: null,
      scrimCloses: false,
      ignoresEscape: true,
    });

    const field = el('input', { type: 'password', class: 'text-input', id: 'again-passphrase' }) as HTMLInputElement;
    field.setAttribute('aria-label', 'Passphrase');
    const signIn = el('button', { type: 'button', class: 'pill-solid', text: 'Sign in' });

    const send = async (): Promise<void> => {
      setPending(signIn, true);
      announce(overlay.status, PENDING.signIn);
      try {
        await request('/api/owner/session', { method: 'POST', body: { passphrase: field.value } });
        open = null;
        overlay.close(null);
        resolve();
      } catch {
        announce(overlay.status, ERRORS.badPassphrase);
      } finally {
        if (signIn.isConnected) setPending(signIn, false);
      }
    };

    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (signIn.dataset.pending === 'true') return;
      void send();
    });
    onPress(signIn, () => {
      void send();
    });

    overlay.body.append(
      el('h2', { class: 'dialog-heading', text: 'Sign in again' }),
      el('p', { class: 'dialog-line', text: SIGN_IN_AGAIN_LINE }),
      el('label', { class: 'field-label', for: 'again-passphrase', text: 'Passphrase' }),
      field,
      signIn,
    );
    focusFirstControl(overlay);
  });
  return open;
};

/**
 * Runs an owner action. An action refused for an ended session opens the sign-in
 * dialog and is sent once more after sign-in, with its original body, If-Match or
 * Idempotency-Key, and its pending and result copy repeating.
 */
export const ownerAction = async <T>(attempt: () => Promise<T>, focusHome: HTMLElement | null): Promise<T> => {
  try {
    return await attempt();
  } catch (error) {
    if (!sessionEnded(error)) throw error;
    await signInAgain();
    if (focusHome !== null && focusHome.isConnected) focusTarget(focusHome);
    return attempt();
  }
};

/** A poll refused for an ended session changes nothing on the page. */
export const pollQuietly = async <T>(attempt: () => Promise<T>): Promise<T | null> => {
  try {
    return await attempt();
  } catch (error) {
    if (sessionEnded(error)) return null;
    throw error;
  }
};
